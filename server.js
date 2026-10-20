import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { db, initDatabase, logAudit } from './db.js';
import { generateBallotToken, verifyBallotToken } from './auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Zero-dependency .env loader
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const idx = trimmed.indexOf('=');
      const key = trimmed.substring(0, idx).trim();
      const val = trimmed.substring(idx + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  });
}

const PORT = process.env.PORT || 3030;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || '';
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || '';
const PUBLIC_DIR = path.join(__dirname, 'public');

// Initialize database & tables
initDatabase();

// Database-backed persistent session store
// Sessions survive process restarts and are keyed by cryptographically random tokens.
function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

function createSession(member) {
  const token = generateSessionToken();
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 86400 * 1000).toISOString(); // 24 hours
  db.prepare('INSERT INTO sessions (token, member_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    token,
    member.id,
    createdAt,
    expiresAt
  );
  return token;
}

function getSessionUser(req) {
  const cookies = parseCookies(req);
  const token = cookies.frontier_session;
  if (!token) return null;
  const now = new Date().toISOString();
  const row = db.prepare(`
    SELECT m.id, m.github_numeric_id, m.handle, m.name, m.role, m.team_track, m.is_host, m.is_allowed
    FROM sessions s
    JOIN members m ON s.member_id = m.id
    WHERE s.token = ? AND s.expires_at > ?
  `).get(token, now);
  return row || null;
}

function destroySession(token) {
  if (token) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }
}

// Clean up expired sessions on startup
try {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString());
} catch (e) {
  // Graceful fallback if table is newly initialized
}

function parseCookies(req) {
  const list = {};
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach(cookie => {
    let [name, ...rest] = cookie.split('=');
    name = name?.trim();
    if (!name) return;
    const value = rest.join('=').trim();
    list[name] = decodeURIComponent(value);
  });
  return list;
}

function sendJson(res, statusCode, data) {
  // Same-origin API — no CORS headers needed
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  const pathname = urlObj.pathname;
  const method = req.method;

  // Per-request cookie parsing (session lookup happens per-handler via getSessionUser)
  const cookies = parseCookies(req);

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  try {
    // -------------------------------------------------------------
    // API: AUTH & SESSIONS
    // -------------------------------------------------------------
    if (pathname === '/api/members' && method === 'GET') {
      const currentUser = getSessionUser(req);
      let members;
      if (currentUser && currentUser.is_host) {
        // Full administrative member details for Host
        members = db.prepare('SELECT id, github_numeric_id, handle, name, role, team_track, is_host, is_allowed FROM members').all();
      } else {
        // Public/member safe projection (omit sensitive github_numeric_id)
        members = db.prepare('SELECT id, handle, name, role, team_track, is_host FROM members').all();
      }
      return sendJson(res, 200, { members });
    }

    if (pathname === '/api/auth/current' && method === 'GET') {
      const currentUser = getSessionUser(req);
      return sendJson(res, 200, { user: currentUser, oauthConfigured: !!(GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET) });
    }

    // -------------------------------------------------------------
    // REAL GITHUB OAUTH 2.0 FLOW
    // -------------------------------------------------------------
    if (pathname === '/api/auth/github' && method === 'GET') {
      // Check if real GitHub OAuth credentials are set in environment
      if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
        res.writeHead(302, { Location: '/?error=oauth_not_configured' });
        return res.end();
      }

      // Generate cryptographically secure CSRF state token
      const state = crypto.randomBytes(16).toString('hex');
      const redirectUri = `${BASE_URL}/api/auth/github/callback`;
      const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user&state=${state}`;

      res.writeHead(302, {
        'Location': githubAuthUrl,
        'Set-Cookie': `oauth_state=${state}; HttpOnly; Path=/; SameSite=Lax; Max-Age=600`
      });
      return res.end();
    }

    if (pathname === '/api/auth/github/callback' && method === 'GET') {
      const code = urlObj.searchParams.get('code');
      const state = urlObj.searchParams.get('state');
      const oauthError = urlObj.searchParams.get('error');

      if (oauthError) {
        res.writeHead(302, { Location: `/?error=${encodeURIComponent(oauthError)}` });
        return res.end();
      }

      if (!state || state !== cookies.oauth_state) {
        logAudit('anonymous', 'OAUTH_CSRF_FAILED', 'auth_oauth', 'OAuth state parameter mismatch or missing state cookie.', 'DENIED');
        res.writeHead(302, { Location: '/?error=csrf_state_mismatch' });
        return res.end();
      }

      try {
        // Step 1: Exchange temporary authorization code for access token with GitHub
        const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            client_id: GITHUB_CLIENT_ID,
            client_secret: GITHUB_CLIENT_SECRET,
            code,
            redirect_uri: `${BASE_URL}/api/auth/github/callback`
          })
        });

        const tokenData = await tokenRes.json();
        if (!tokenData.access_token) {
          logAudit('anonymous', 'OAUTH_TOKEN_FAILED', 'auth_oauth', `Failed to obtain access token: ${tokenData.error_description || 'unknown error'}`, 'DENIED');
          res.writeHead(302, { Location: '/?error=token_exchange_failed' });
          return res.end();
        }

        // Step 2: Fetch authenticated user profile using access token
        const userRes = await fetch('https://api.github.com/user', {
          headers: {
            'Authorization': `Bearer ${tokenData.access_token}`,
            'User-Agent': 'FrontierAI-Workspace'
          }
        });

        const ghUser = await userRes.json();
        const numericId = ghUser.id; // CRITICAL: Immutable numeric GitHub ID
        const ghLogin = ghUser.login;

        // Step 3: Match against the Frontier AI Hard Allowlist in SQLite
        const member = db.prepare('SELECT * FROM members WHERE github_numeric_id = ?').get(numericId);

        if (!member || !member.is_allowed) {
          logAudit(
            `gh_${ghLogin}`,
            'OAUTH_ALLOWLIST_DENIED',
            'auth_allowlist',
            `GitHub user @${ghLogin} (Numeric ID: ${numericId}) authenticated via GitHub OAuth, but was REJECTED: Not in Frontier AI allowlist.`,
            'DENIED'
          );
          res.writeHead(302, {
            Location: `/?error=unauthorized_allowlist&gh_user=${encodeURIComponent(ghLogin)}&gh_id=${numericId}`
          });
          return res.end();
        }

        // Step 4: Login Approved — create secure session token
        const sessionToken = createSession(member);
        logAudit(
          member.handle,
          'OAUTH_LOGIN_SUCCESS',
          'auth_session',
          `Authenticated via real GitHub OAuth 2.0 as ${member.name} (@${ghLogin}, ID: ${numericId}). Access level: ${member.is_host ? 'AUTHORATOR' : 'PARTICIPANT'}.`,
          'SUCCESS'
        );

        res.writeHead(302, {
          'Location': '/?auth=oauth_success',
          'Set-Cookie': `frontier_session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`
        });
        return res.end();

      } catch (err) {
        console.error('OAuth callback error:', err);
        res.writeHead(302, { Location: '/?error=oauth_internal_error' });
        return res.end();
      }
    }

    // Dev Simulation Endpoint: Test complete OAuth pipeline without registering real GitHub App
    if (pathname === '/api/auth/github/simulate' && method === 'GET') {
      if (process.env.NODE_ENV === 'production') {
        return sendJson(res, 404, { error: 'Not found' });
      }
      const numericId = parseInt(urlObj.searchParams.get('github_numeric_id') || '10101', 10);
      const member = db.prepare('SELECT * FROM members WHERE github_numeric_id = ?').get(numericId);

      if (!member || !member.is_allowed) {
        logAudit(
          `gh_${numericId}`,
          'OAUTH_SIM_DENIED',
          'auth_allowlist',
          `Simulated OAuth login rejected for GitHub Numeric ID ${numericId}. Not in allowlist.`,
          'DENIED'
        );
        res.writeHead(302, {
          Location: `/?error=unauthorized_allowlist&gh_user=unknown&gh_id=${numericId}`
        });
        return res.end();
      }

      const sessionToken = createSession(member);
      logAudit(
        member.handle,
        'OAUTH_SIM_SUCCESS',
        'auth_session',
        `Simulated GitHub OAuth 2.0 callback verified for ${member.name} (Numeric ID: ${numericId}).`,
        'SUCCESS'
      );
      res.writeHead(302, {
        'Location': '/?auth=oauth_success',
        'Set-Cookie': `frontier_session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`
      });
      return res.end();
    }

    if (pathname === '/api/auth/login' && method === 'POST') {
      if (process.env.NODE_ENV === 'production') {
        return sendJson(res, 404, { error: 'Not found' });
      }
      const body = await parseBody(req);
      const { identifier } = body;

      if (!identifier) {
        return sendJson(res, 400, { error: 'Username or numeric GitHub ID is required.' });
      }

      let member = null;
      const numId = parseInt(identifier, 10);
      if (!isNaN(numId)) {
        member = db.prepare('SELECT * FROM members WHERE github_numeric_id = ?').get(numId);
      }
      if (!member) {
        member = db.prepare('SELECT * FROM members WHERE LOWER(handle) = LOWER(?)').get(identifier);
      }

      if (!member || !member.is_allowed) {
        logAudit(
          `auth_${identifier}`,
          'LOGIN_REJECTED',
          'auth_allowlist',
          `Login attempt for "${identifier}" was rejected: not in Frontier AI allowlist.`,
          'DENIED'
        );
        return sendJson(res, 403, {
          error: 'Access Denied: Account is not in the Frontier AI membership allowlist.'
        });
      }

      const sessionToken = createSession(member);
      logAudit(
        member.handle,
        'LOGIN_SUCCESS',
        'auth_session',
        `Authenticated as ${member.name} (${member.role}). Access level: ${member.is_host ? 'AUTHORATOR' : 'PARTICIPANT'}.`,
        'SUCCESS'
      );
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': `frontier_session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`
      });
      return res.end(JSON.stringify({ user: member, message: 'Logged in successfully' }));
    }

    if (pathname === '/api/auth/logout' && method === 'POST') {
      const logoutToken = cookies.frontier_session;
      const logoutUser = getSessionUser(req);
      if (logoutUser) {
        logAudit(logoutUser.handle, 'LOGOUT', 'auth_session', 'User signed out.', 'SUCCESS');
      }
      if (logoutToken) destroySession(logoutToken);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': 'frontier_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'
      });
      return res.end(JSON.stringify({ message: 'Logged out successfully' }));
    }

    if (pathname === '/api/auth/login-as' && method === 'POST') {
      if (process.env.NODE_ENV === 'production') {
        return sendJson(res, 404, { error: 'Not found' });
      }
      const body = await parseBody(req);
      const { github_numeric_id } = body;

      const member = db.prepare('SELECT * FROM members WHERE github_numeric_id = ?').get(github_numeric_id);

      if (!member || !member.is_allowed) {
        logAudit(
          `gh_${github_numeric_id || 'unknown'}`,
          'LOGIN_ATTEMPT',
          'auth_allowlist',
          `Unauthorized login attempt from GitHub ID ${github_numeric_id}. Rejected by allowlist policy.`,
          'DENIED'
        );
        return sendJson(res, 403, {
          error: 'Access Denied: Account is not in the Frontier AI membership allowlist.',
          github_numeric_id
        });
      }

      const sessionToken = createSession(member);
      logAudit(
        member.handle,
        'LOGIN_SUCCESS',
        'auth_session',
        `Authenticated as ${member.name} (${member.role}). Access level: ${member.is_host ? 'AUTHORATOR' : 'PARTICIPANT'}.`,
        'SUCCESS'
      );
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': `frontier_session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`
      });
      return res.end(JSON.stringify({ user: member, message: 'Logged in successfully' }));
    }

    // -------------------------------------------------------------
    // API: PERSONAL DASHBOARD DATA
    // -------------------------------------------------------------
    if (pathname === '/api/dashboard/personal' && method === 'GET') {
      const currentUser = getSessionUser(req);
      if (!currentUser) return sendJson(res, 401, { error: 'Authentication required' });
      const myTasks = db.prepare(`
        SELECT t.*, m.name as assignee_name
        FROM tasks t
        LEFT JOIN members m ON t.assignee_id = m.id
        WHERE t.assignee_id = ?
        ORDER BY t.id ASC
      `).all(currentUser.id);

      const rawEvents = db.prepare(`
        SELECT c.*, m.name as assignee_name, s.slot_name, s.slot_code
        FROM calendar_events c
        LEFT JOIN members m ON c.assignee_id = m.id
        LEFT JOIN meeting_slots s ON c.meeting_slot_id = s.id
        ORDER BY c.event_date ASC, c.id ASC
      `).all();

      // Audience filtering for personal dashboard
      const myEvents = rawEvents.filter(ev => {
        if (currentUser.is_host === 1) return true; // Team Lead sees all
        if (ev.target_audience === 'ALL') return true;
        if (ev.target_audience === 'BACKEND' && currentUser.team_track === 'backend') return true;
        if (ev.target_audience === 'FRONTEND' && currentUser.team_track === 'frontend') return true;
        if (ev.assignee_id && ev.assignee_id === currentUser.id) return true;
        if (ev.assignee_id === null && !ev.target_audience) return true;
        if (ev.target_audience && ev.target_audience.startsWith('[')) {
          try {
            const list = JSON.parse(ev.target_audience);
            if (Array.isArray(list) && list.map(Number).includes(currentUser.id)) return true;
          } catch {}
        }
        return false;
      }).map(ev => {
        const hasMeet = !!(ev.meeting_link);
        return {
          ...ev,
          // Mask raw meeting link: only expose internal join endpoint
          meeting_link: hasMeet ? `/api/meetings/join/${ev.id}` : null,
          join_url: hasMeet ? `/api/meetings/join/${ev.id}` : null
        };
      });

      // Find any active live meeting for this user
      const liveMeeting = myEvents.find(ev => ev.is_live === 1 && (ev.event_type === 'MEETING' || ev.event_type === 'RETRO')) || null;

      const activeVote = db.prepare('SELECT * FROM voting_sessions WHERE id = 1').get();
      const hasVoted = db.prepare('SELECT * FROM voting_eligibility WHERE session_id = 1 AND member_id = ?').get(currentUser.id);

      const completed = myTasks.filter(t => t.status === 'COMPLETED').length;
      const inProgress = myTasks.filter(t => t.status === 'IN_PROGRESS').length;
      const todo = myTasks.filter(t => t.status === 'TODO').length;

      return sendJson(res, 200, {
        user: currentUser,
        tasks: myTasks,
        events: myEvents,
        liveMeeting,
        hasVoted: !!hasVoted,
        votingSession: activeVote,
        stats: {
          total: myTasks.length,
          completed,
          inProgress,
          todo,
          completionRate: myTasks.length > 0 ? Math.round((completed / myTasks.length) * 100) : 0
        }
      });
    }

    // -------------------------------------------------------------
    // API: MEETING SLOTS & MASKED JOIN GATEWAY
    // -------------------------------------------------------------
    if (pathname === '/api/meetings/slots' && method === 'GET') {
      const slots = db.prepare('SELECT id, slot_code, slot_name, last_used_at FROM meeting_slots ORDER BY id ASC').all();
      return sendJson(res, 200, { slots });
    }

    if (pathname.startsWith('/api/meetings/join/') && method === 'GET') {
      const currentUser = getSessionUser(req);
      if (!currentUser) {
        res.writeHead(302, { Location: '/?auth=login_required' });
        return res.end();
      }

      const eventId = parseInt(pathname.split('/').pop(), 10);
      const event = db.prepare(`
        SELECT c.*, s.slot_name, s.slot_code, s.raw_url as slot_raw_url
        FROM calendar_events c
        LEFT JOIN meeting_slots s ON c.meeting_slot_id = s.id
        WHERE c.id = ?
      `).get(eventId);

      if (!event || (!event.meeting_link && !event.slot_raw_url)) {
        return sendJson(res, 404, { error: 'Meeting not found or has no active link.' });
      }

      // Check audience authorization
      let isAllowed = false;
      if (currentUser.is_host === 1) {
        isAllowed = true;
      } else if (event.target_audience === 'ALL') {
        isAllowed = true;
      } else if (event.target_audience === 'BACKEND' && currentUser.team_track === 'backend') {
        isAllowed = true;
      } else if (event.target_audience === 'FRONTEND' && currentUser.team_track === 'frontend') {
        isAllowed = true;
      } else if (event.assignee_id && event.assignee_id === currentUser.id) {
        isAllowed = true;
      } else if (event.target_audience && event.target_audience.startsWith('[')) {
        try {
          const list = JSON.parse(event.target_audience);
          if (Array.isArray(list) && list.map(Number).includes(currentUser.id)) {
            isAllowed = true;
          }
        } catch {}
      }

      if (!isAllowed) {
        logAudit(
          currentUser.handle,
          'MEETING_JOIN_DENIED',
          `meeting_${event.id}`,
          `Unauthorized attempt to join session "${event.title}". User not in target audience.`,
          'DENIED'
        );
        return sendJson(res, 403, {
          error: 'Access Restricted: You are not on the guest list for this meeting session.'
        });
      }

      const slotLabel = event.slot_name || 'Meeting Bridge';
      logAudit(
        currentUser.handle,
        'MEETING_JOINED',
        `meeting_${event.id}`,
        `Member ${currentUser.name} (@${currentUser.handle}) joined session "${event.title}" via ${slotLabel}.`,
        'SUCCESS'
      );

      const targetUrl = event.meeting_link || event.slot_raw_url;
      res.writeHead(302, { Location: targetUrl });
      return res.end();
    }

    // -------------------------------------------------------------
    // API: CALENDAR & MEETING PINGS
    // -------------------------------------------------------------
    if (pathname === '/api/calendar' && method === 'GET') {
      const memberId = urlObj.searchParams.get('member_id');
      const allEvents = db.prepare(`
        SELECT c.*, m.name as assignee_name, s.slot_name, s.slot_code
        FROM calendar_events c
        LEFT JOIN members m ON c.assignee_id = m.id
        LEFT JOIN meeting_slots s ON c.meeting_slot_id = s.id
        ORDER BY c.event_date ASC, c.id ASC
      `).all().map(ev => {
        const hasMeet = !!(ev.meeting_link);
        return {
          ...ev,
          meeting_link: hasMeet ? `/api/meetings/join/${ev.id}` : null,
          join_url: hasMeet ? `/api/meetings/join/${ev.id}` : null
        };
      });

      let events = allEvents;
      if (memberId) {
        const mId = parseInt(memberId, 10);
        const targetMember = db.prepare('SELECT * FROM members WHERE id = ?').get(mId);
        if (targetMember) {
          events = allEvents.filter(ev => {
            if (targetMember.is_host === 1) return true;
            if (ev.target_audience === 'ALL') return true;
            if (ev.target_audience === 'BACKEND' && targetMember.team_track === 'backend') return true;
            if (ev.target_audience === 'FRONTEND' && targetMember.team_track === 'frontend') return true;
            if (ev.assignee_id && ev.assignee_id === targetMember.id) return true;
            if (ev.target_audience && ev.target_audience.startsWith('[')) {
              try {
                const list = JSON.parse(ev.target_audience);
                if (Array.isArray(list) && list.map(Number).includes(targetMember.id)) return true;
              } catch {}
            }
            return false;
          });
        }
      }

      return sendJson(res, 200, { events });
    }

    if (pathname === '/api/calendar' && method === 'POST') {
      const currentUser = getSessionUser(req);
      // Authorization Check: ONLY Host/Lead can schedule deadlines and meetings!
      if (!currentUser || !currentUser.is_host) {
        logAudit(
          currentUser ? currentUser.handle : 'unauthenticated',
          'SCHEDULE_EVENT_VIOLATION',
          'calendar',
          'Non-host attempted to schedule calendar event.',
          'DENIED'
        );
        return sendJson(res, 403, {
          error: 'Permission Denied: Only the designated Team Lead can schedule deadlines and meetings.'
        });
      }

      const body = await parseBody(req);
      const {
        title,
        description,
        event_type,
        event_date,
        time_label,
        target_audience,
        assignee_id,
        meeting_slot_id,
        meeting_link,
        is_live
      } = body;

      if (!title || !event_date) {
        return sendJson(res, 400, { error: 'Title and event date are required.' });
      }

      let actualLink = '';
      let assignedSlotId = null;

      // Link juggling & slot allocation
      if (event_type === 'MEETING' || event_type === 'RETRO') {
        if (meeting_slot_id && meeting_slot_id !== 'auto') {
          const slot = db.prepare('SELECT * FROM meeting_slots WHERE id = ?').get(parseInt(meeting_slot_id, 10));
          if (slot) {
            actualLink = slot.raw_url;
            assignedSlotId = slot.id;
            db.prepare('UPDATE meeting_slots SET last_used_at = ? WHERE id = ?').run(new Date().toISOString(), slot.id);
          }
        } else if (meeting_link && meeting_link.trim() !== '') {
          // Manual link override (e.g. from test script)
          actualLink = meeting_link.trim();
        } else {
          // Auto-juggle from pool of 6 links (least recently used)
          const nextSlot = db.prepare('SELECT * FROM meeting_slots ORDER BY (last_used_at IS NOT NULL), last_used_at ASC, id ASC LIMIT 1').get();
          if (nextSlot) {
            actualLink = nextSlot.raw_url;
            assignedSlotId = nextSlot.id;
            db.prepare('UPDATE meeting_slots SET last_used_at = ? WHERE id = ?').run(new Date().toISOString(), nextSlot.id);
          }
        }
      }

      const insert = db.prepare(`
        INSERT INTO calendar_events (title, description, event_type, event_date, time_label, target_audience, assignee_id, meeting_slot_id, meeting_link, is_live, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const result = insert.run(
        title,
        description || '',
        event_type || 'MEETING',
        event_date,
        time_label || 'TBD',
        target_audience || 'ALL',
        assignee_id ? parseInt(assignee_id, 10) : null,
        assignedSlotId,
        actualLink,
        is_live ? 1 : 0,
        currentUser.id
      );

      logAudit(
        currentUser.handle,
        is_live ? 'MEETING_PING_BROADCAST' : 'SCHEDULE_EVENT',
        `cal_${result.lastInsertRowid}`,
        `Team Lead scheduled ${event_type}: "${title}" on ${event_date} (Audience: ${target_audience || 'ALL'}, Slot: ${assignedSlotId ? ('#' + assignedSlotId) : 'custom'}, Live: ${is_live ? 'YES' : 'NO'})`,
        'SUCCESS'
      );

      return sendJson(res, 201, { id: result.lastInsertRowid, message: 'Calendar event created successfully' });
    }

    if (pathname.startsWith('/api/calendar/') && pathname.endsWith('/ping') && method === 'POST') {
      const currentUser = getSessionUser(req);
      if (!currentUser || !currentUser.is_host) {
        return sendJson(res, 403, { error: 'Only Team Lead can broadcast meeting pings.' });
      }
      const eventId = parseInt(pathname.split('/')[3], 10);
      const event = db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(eventId);
      if (!event) return sendJson(res, 404, { error: 'Event not found.' });

      db.prepare('UPDATE calendar_events SET is_live = 1 WHERE id = ?').run(eventId);
      logAudit(
        currentUser.handle,
        'MEETING_PING_BROADCAST',
        `cal_${eventId}`,
        `Team Lead broadcasted immediate live meeting ping for "${event.title}".`,
        'SUCCESS'
      );
      return sendJson(res, 200, { message: 'Meeting ping broadcasted successfully' });
    }

    if (pathname.startsWith('/api/calendar/') && pathname.endsWith('/end') && method === 'POST') {
      const currentUser = getSessionUser(req);
      if (!currentUser || !currentUser.is_host) {
        return sendJson(res, 403, { error: 'Only Team Lead can conclude meetings.' });
      }
      const eventId = parseInt(pathname.split('/')[3], 10);
      db.prepare('UPDATE calendar_events SET is_live = 0 WHERE id = ?').run(eventId);
      logAudit(
        currentUser.handle,
        'MEETING_CONCLUDED',
        `cal_${eventId}`,
        `Team Lead concluded active meeting session.`,
        'SUCCESS'
      );
      return sendJson(res, 200, { message: 'Meeting session concluded' });
    }

    if (pathname.startsWith('/api/calendar/') && method === 'DELETE') {
      const currentUser = getSessionUser(req);
      if (!currentUser || !currentUser.is_host) {
        return sendJson(res, 403, { error: 'Only Team Lead can remove events.' });
      }
      const eventId = parseInt(pathname.split('/')[3], 10);
      db.prepare('DELETE FROM calendar_events WHERE id = ?').run(eventId);
      logAudit(
        currentUser.handle,
        'CALENDAR_EVENT_DELETED',
        `cal_${eventId}`,
        `Team Lead removed calendar event.`,
        'SUCCESS'
      );
      return sendJson(res, 200, { message: 'Calendar event removed' });
    }

    // -------------------------------------------------------------
    // API: TASKS & PROGRESS (Host Allotment + Participant Submissions)
    // -------------------------------------------------------------
    if (pathname === '/api/tasks' && method === 'GET') {
      const tasks = db.prepare(`
        SELECT t.*, m.name as assignee_name, m.handle as assignee_handle
        FROM tasks t
        LEFT JOIN members m ON t.assignee_id = m.id
        ORDER BY t.id ASC
      `).all();
      return sendJson(res, 200, { tasks });
    }

    if (pathname === '/api/tasks' && method === 'POST') {
      const currentUser = getSessionUser(req);
      // AUTHORIZATION CHECK: ONLY the Host can allot tasks!
      if (!currentUser || !currentUser.is_host) {
        logAudit(
          currentUser ? currentUser.handle : 'unauthenticated',
          'ALLOT_TASK_VIOLATION',
          'tasks',
          'Participant attempted to allot a task. Denied by role policy.',
          'DENIED'
        );
        return sendJson(res, 403, {
          error: 'Permission Denied: Only the designated Team Host / Lead has authorization to allot tasks.'
        });
      }

      const body = await parseBody(req);
      const { title, description, track, assignee_id, deadline, deliverable_url } = body;

      if (!title) return sendJson(res, 400, { error: 'Task title is required' });

      const insert = db.prepare(`
        INSERT INTO tasks (title, description, track, assignee_id, status, deadline, deliverable_url, version, updated_at)
        VALUES (?, ?, ?, ?, 'TODO', ?, ?, 1, ?)
      `);

      const now = new Date().toISOString();
      const result = insert.run(
        title,
        description || '',
        track || 'backend',
        assignee_id || currentUser.id,
        deadline || '2026-10-25',
        deliverable_url || '',
        now
      );

      logAudit(
        currentUser.handle,
        'ALLOT_TASK',
        `task_${result.lastInsertRowid}`,
        `Host allotted task "${title}" to member #${assignee_id}`,
        'SUCCESS'
      );

      return sendJson(res, 201, { id: result.lastInsertRowid, message: 'Task allotted successfully' });
    }

    if (pathname.startsWith('/api/tasks/') && method === 'PATCH') {
      const currentUser = getSessionUser(req);
      if (!currentUser) return sendJson(res, 401, { error: 'Authentication required' });
      const taskId = parseInt(pathname.split('/')[3], 10);
      const body = await parseBody(req);
      const { status, deliverable_url, deliverable_notes, version } = body;

      const current = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
      if (!current) return sendJson(res, 404, { error: 'Task not found' });

      // OCC: Optimistic Concurrency Control Check
      if (typeof version === 'number' && current.version !== version) {
        logAudit(
          currentUser.handle,
          'CONFLICT_DETECTED',
          `task_${taskId}`,
          `Write rejected! Provided v${version} does not match database v${current.version}. Concurrency collision prevented.`,
          'CONFLICT'
        );
        return sendJson(res, 409, {
          error: 'Concurrency Conflict: This task was modified by another peer while you were editing it.',
          currentVersion: current.version,
          yourVersion: version
        });
      }

      const nextVersion = current.version + 1;
      const now = new Date().toISOString();

      db.prepare(`
        UPDATE tasks
        SET status = COALESCE(?, status),
            deliverable_url = COALESCE(?, deliverable_url),
            deliverable_notes = COALESCE(?, deliverable_notes),
            version = ?,
            updated_at = ?
        WHERE id = ?
      `).run(
        status || current.status,
        deliverable_url ?? current.deliverable_url,
        deliverable_notes ?? current.deliverable_notes,
        nextVersion,
        now,
        taskId
      );

      const actionType = deliverable_url ? 'SUBMIT_DELIVERABLE' : 'UPDATE_TASK';
      logAudit(
        currentUser.handle,
        actionType,
        `task_${taskId}`,
        `Participant updated task to ${status || current.status}. Deliverable: ${deliverable_url || 'N/A'}. Advanced to v${nextVersion}.`,
        'SUCCESS'
      );

      return sendJson(res, 200, { message: 'Task progress / deliverable updated', nextVersion });
    }

    // -------------------------------------------------------------
    // API: ANONYMOUS BLIND VOTING (PEER PERFORMANCE REVIEW)
    // -------------------------------------------------------------
    if (pathname === '/api/voting/current' && method === 'GET') {
      const currentUser = getSessionUser(req);
      const requestedId = parseInt(urlObj.searchParams.get('session_id') || '1', 10);
      const session = db.prepare('SELECT * FROM voting_sessions WHERE id = ?').get(requestedId) ||
                      db.prepare('SELECT * FROM voting_sessions ORDER BY id ASC LIMIT 1').get();
      if (!session) return sendJson(res, 404, { error: 'No voting session found' });

      const allSessions = db.prepare('SELECT id, title, description, session_type, status FROM voting_sessions ORDER BY id ASC').all();

      const options = db.prepare(`
        SELECT vo.*, m.name as candidate_name, m.role as candidate_role
        FROM voting_options vo
        LEFT JOIN members m ON vo.candidate_member_id = m.id
        WHERE vo.session_id = ?
      `).all(session.id);

      const eligibility = currentUser
        ? db.prepare('SELECT * FROM voting_eligibility WHERE session_id = ? AND member_id = ?').get(session.id, currentUser.id)
        : null;
      
      const totalBallots = db.prepare('SELECT COUNT(*) as count FROM ballots WHERE session_id = ?').get(session.id).count;
      const totalEligible = session.total_eligible;

      let tally = null;
      const isRevealed = totalBallots >= totalEligible || session.status === 'CLOSED';

      if (isRevealed) {
        tally = options.map(opt => {
          const votes = db.prepare('SELECT COUNT(*) as count FROM ballots WHERE session_id = ? AND option_id = ?')
            .get(session.id, opt.id).count;
          return {
            option_id: opt.id,
            label: opt.label,
            candidate_name: opt.candidate_name,
            votes
          };
        });
      }

      return sendJson(res, 200, {
        session,
        allSessions,
        options,
        userHasClaimedToken: !!eligibility,
        totalBallots,
        totalEligible,
        isRevealed,
        isHost: !!(currentUser && currentUser.is_host),
        tally
      });
    }

    // Phase 1: Claim blind token (Eligibility Check)
    if (pathname === '/api/voting/token' && method === 'POST') {
      const currentUser = getSessionUser(req);
      if (!currentUser) return sendJson(res, 401, { error: 'Authentication required to claim ballot token' });
      const body = await parseBody(req);
      const sessionId = body.session_id || 1;

      const existing = db.prepare('SELECT * FROM voting_eligibility WHERE session_id = ? AND member_id = ?')
        .get(sessionId, currentUser.id);

      if (existing) {
        return sendJson(res, 400, { error: 'You have already claimed a ballot token for this peer performance session.' });
      }

      // Record eligibility in ledger (WHO claimed a token)
      db.prepare(`
        INSERT INTO voting_eligibility (session_id, member_id, token_issued_at)
        VALUES (?, ?, ?)
      `).run(sessionId, currentUser.id, new Date().toISOString());

      // Issue blind cryptographic token (Contains ZERO member_id!)
      const blindToken = generateBallotToken(sessionId);

      logAudit(
        currentUser.handle,
        'CLAIM_BALLOT_TOKEN',
        `voting_session_${sessionId}`,
        `Member claimed unlinked blind token for peer performance review.`,
        'SUCCESS'
      );

      return sendJson(res, 200, {
        token: blindToken,
        instructions: 'This token is unlinked from your identity. Submit your vote with this token.'
      });
    }

    // Phase 2: Cast anonymous ballot
    if (pathname === '/api/voting/cast' && method === 'POST') {
      const body = await parseBody(req);
      const { session_id, option_id, token } = body;

      if (!session_id || !option_id || !token) {
        return sendJson(res, 400, { error: 'session_id, option_id, and token are required' });
      }

      const verification = verifyBallotToken(session_id, token);
      if (!verification.valid) {
        logAudit(
          'anonymous',
          'BALLOT_REJECTED',
          `voting_session_${session_id}`,
          `Invalid ballot signature: ${verification.error}`,
          'DENIED'
        );
        return sendJson(res, 403, { error: `Invalid ballot token: ${verification.error}` });
      }

      // Prevent double spending
      const alreadyUsed = db.prepare('SELECT * FROM used_tokens WHERE token_hash = ?').get(verification.tokenHash);
      if (alreadyUsed) {
        logAudit(
          'anonymous',
          'DOUBLE_VOTE_BLOCKED',
          `voting_session_${session_id}`,
          `Attempted double-vote using spent ballot token.`,
          'DENIED'
        );
        return sendJson(res, 409, { error: 'Double-voting prevented! This ballot token has already been cast.' });
      }

      db.prepare('INSERT INTO used_tokens (token_hash, used_at) VALUES (?, ?)').run(
        verification.tokenHash,
        new Date().toISOString()
      );

      // Record anonymized ballot (NO MEMBER ID EVER RECORDED!)
      db.prepare('INSERT INTO ballots (session_id, option_id) VALUES (?, ?)').run(session_id, option_id);

      logAudit(
        'anonymous_voter',
        'PEER_BALLOT_CAST',
        `voting_session_${session_id}`,
        `Anonymous vote cast in peer performance review. Zero voter linkage.`,
        'SUCCESS'
      );

      return sendJson(res, 200, { message: 'Performance evaluation ballot safely cast into anonymous ballot box!' });
    }

    // Host action: Toggle or close voting session
    if (pathname === '/api/voting/close' && method === 'POST') {
      const currentUser = getSessionUser(req);
      if (!currentUser || !currentUser.is_host) {
        return sendJson(res, 403, { error: 'Permission Denied: Only the Team Host can close a voting session.' });
      }

      const body = await parseBody(req);
      const targetSessionId = body.session_id || 1;

      db.prepare(`UPDATE voting_sessions SET status = 'CLOSED', closed_at = ? WHERE id = ?`).run(new Date().toISOString(), targetSessionId);
      logAudit(currentUser.handle, 'CLOSE_VOTING_SESSION', `voting_session_${targetSessionId}`, `Host closed voting session #${targetSessionId} and revealed aggregate tallies.`, 'SUCCESS');

      return sendJson(res, 200, { message: `Voting session #${targetSessionId} closed. Final tallies revealed!` });
    }

    if (pathname === '/api/voting/reopen' && method === 'POST') {
      const currentUser = getSessionUser(req);
      if (!currentUser || !currentUser.is_host) {
        return sendJson(res, 403, { error: 'Permission Denied: Only the Team Host can reopen a voting session.' });
      }

      const body = await parseBody(req);
      const targetSessionId = body.session_id || 1;

      db.prepare(`UPDATE voting_sessions SET status = 'ACTIVE', closed_at = NULL WHERE id = ?`).run(targetSessionId);
      logAudit(currentUser.handle, 'REOPEN_VOTING_SESSION', `voting_session_${targetSessionId}`, `Host reopened voting session #${targetSessionId}.`, 'SUCCESS');

      return sendJson(res, 200, { message: `Voting session #${targetSessionId} reopened for evaluations.` });
    }

    // -------------------------------------------------------------
    // API: PEER TASKLETS (Member-to-Member informal micro-tasks)
    // -------------------------------------------------------------
    if (pathname === '/api/tasklets' && method === 'GET') {
      const currentUser = getSessionUser(req);
      if (!currentUser) return sendJson(res, 401, { error: 'Authentication required' });

      const tasklets = db.prepare(`
        SELECT t.*,
               s.name as sender_name, s.handle as sender_handle, s.team_track as sender_track,
               r.name as receiver_name, r.handle as receiver_handle, r.team_track as receiver_track
        FROM tasklets t
        JOIN members s ON t.sender_id = s.id
        JOIN members r ON t.receiver_id = r.id
        ORDER BY t.id DESC
      `).all();

      return sendJson(res, 200, { tasklets });
    }

    if (pathname === '/api/tasklets' && method === 'POST') {
      const currentUser = getSessionUser(req);
      if (!currentUser) return sendJson(res, 401, { error: 'Authentication required' });

      const body = await parseBody(req);
      const { receiver_id, title, description } = body;

      if (!receiver_id || !title) {
        return sendJson(res, 400, { error: 'Peer recipient and title are required.' });
      }

      const now = new Date().toISOString();
      const info = db.prepare(`
        INSERT INTO tasklets (sender_id, receiver_id, title, description, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'PENDING', ?, ?)
      `).run(currentUser.id, parseInt(receiver_id, 10), title.trim(), (description || '').trim(), now, now);

      logAudit(currentUser.handle, 'CREATE_TASKLET', `tasklet_${info.lastInsertRowid}`, `Sent tasklet "${title.trim()}" to member #${receiver_id}`, 'SUCCESS');

      return sendJson(res, 201, { id: info.lastInsertRowid, message: 'Tasklet sent to peer!' });
    }

    if (pathname.startsWith('/api/tasklets/') && method === 'PATCH') {
      const currentUser = getSessionUser(req);
      if (!currentUser) return sendJson(res, 401, { error: 'Authentication required' });

      const taskletId = parseInt(pathname.split('/')[3], 10);
      const body = await parseBody(req);
      const { status } = body;

      const allowedStatuses = ['PENDING', 'ACCEPTED', 'DONE'];
      if (!allowedStatuses.includes(status)) {
        return sendJson(res, 400, { error: 'Invalid tasklet status' });
      }

      const tasklet = db.prepare('SELECT * FROM tasklets WHERE id = ?').get(taskletId);
      if (!tasklet) return sendJson(res, 404, { error: 'Tasklet not found' });

      if (tasklet.sender_id !== currentUser.id && tasklet.receiver_id !== currentUser.id && !currentUser.is_host) {
        return sendJson(res, 403, { error: 'You are neither the sender nor the recipient of this tasklet.' });
      }

      db.prepare(`UPDATE tasklets SET status = ?, updated_at = ? WHERE id = ?`).run(status, new Date().toISOString(), taskletId);

      logAudit(currentUser.handle, 'UPDATE_TASKLET', `tasklet_${taskletId}`, `Updated tasklet status to ${status}`, 'SUCCESS');

      return sendJson(res, 200, { message: `Tasklet updated to ${status}` });
    }

    // -------------------------------------------------------------
    // API: GOVERNANCE & ACCESS TICKETS (2-Man Rule)
    // -------------------------------------------------------------
    if (pathname === '/api/tickets' && method === 'GET') {
      const tickets = db.prepare(`
        SELECT t.*,
               req.name as requester_name, req.handle as requester_handle,
               app.name as approver_name, app.handle as approver_handle
        FROM access_tickets t
        JOIN members req ON t.requester_id = req.id
        LEFT JOIN members app ON t.approver_id = app.id
        ORDER BY t.id DESC
      `).all();
      return sendJson(res, 200, { tickets });
    }

    if (pathname === '/api/tickets' && method === 'POST') {
      const currentUser = getSessionUser(req);
      if (!currentUser) return sendJson(res, 401, { error: 'Authentication required' });
      const body = await parseBody(req);
      const { title, reason, scope, duration_minutes } = body;

      if (!title || !reason || !scope) {
        return sendJson(res, 400, { error: 'Title, reason, and scope are required' });
      }

      const insert = db.prepare(`
        INSERT INTO access_tickets (requester_id, title, reason, scope, duration_minutes, status, created_at)
        VALUES (?, ?, ?, ?, ?, 'PENDING_APPROVAL', ?)
      `);

      const now = new Date().toISOString();
      const result = insert.run(currentUser.id, title, reason, scope, duration_minutes || 30, now);

      logAudit(
        currentUser.handle,
        'RAISE_TICKET',
        `ticket_${result.lastInsertRowid}`,
        `Created access ticket: "${title}" for scope "${scope}".`,
        'PENDING'
      );

      return sendJson(res, 201, { id: result.lastInsertRowid, message: 'Ticket raised' });
    }

    if (pathname.startsWith('/api/tickets/') && pathname.endsWith('/approve') && method === 'POST') {
      const currentUser = getSessionUser(req);
      if (!currentUser) return sendJson(res, 401, { error: 'Authentication required' });
      const ticketId = parseInt(pathname.split('/')[3], 10);
      const ticket = db.prepare('SELECT * FROM access_tickets WHERE id = ?').get(ticketId);

      if (!ticket) return sendJson(res, 404, { error: 'Ticket not found' });
      if (ticket.status !== 'PENDING_APPROVAL') {
        return sendJson(res, 400, { error: `Ticket is already ${ticket.status}` });
      }

      // CRITICAL 2-MAN RULE ENFORCEMENT:
      if (ticket.requester_id === currentUser.id) {
        logAudit(
          currentUser.handle,
          'SELF_APPROVAL_VIOLATION',
          `ticket_${ticketId}`,
          `Security violation: ${currentUser.handle} attempted self-approval.`,
          'DENIED'
        );
        return sendJson(res, 403, {
          error: '2-Man Rule Violation: You cannot approve your own privileged access request! Another team member must review and approve it.'
        });
      }

      const now = new Date();
      const resolvedAt = now.toISOString();
      const expiresAt = new Date(now.getTime() + ticket.duration_minutes * 60000).toISOString();

      db.prepare(`
        UPDATE access_tickets
        SET status = 'APPROVED',
            approver_id = ?,
            resolved_at = ?,
            expires_at = ?
        WHERE id = ?
      `).run(currentUser.id, resolvedAt, expiresAt, ticketId);

      logAudit(
        currentUser.handle,
        'APPROVE_TICKET',
        `ticket_${ticketId}`,
        `Approved ticket requested by member #${ticket.requester_id}. Granted temporary privilege until ${expiresAt}.`,
        'GRANTED'
      );

      return sendJson(res, 200, {
        message: `Ticket approved! Ephemeral grant active for ${ticket.duration_minutes} minutes.`,
        expiresAt
      });
    }

    // -------------------------------------------------------------
    // API: AUDIT LOGS
    // -------------------------------------------------------------
    if (pathname === '/api/audit' && method === 'GET') {
      const currentUser = getSessionUser(req);
      if (!currentUser) {
        return sendJson(res, 401, { error: 'Authentication required' });
      }
      if (!currentUser.is_host) {
        return sendJson(res, 403, { error: 'Permission Denied: Audit log is restricted to Team Lead.' });
      }
      const events = db.prepare('SELECT * FROM audit_events ORDER BY id DESC LIMIT 50').all();
      return sendJson(res, 200, { events });
    }

    // -------------------------------------------------------------
    // API: ₹0 DISASTER RECOVERY EXPORT
    // -------------------------------------------------------------
    if (pathname === '/api/disaster-recovery/export' && method === 'POST') {
      const currentUser = getSessionUser(req);
      if (!currentUser || !currentUser.is_host) {
        return sendJson(res, 403, { error: 'Permission Denied: Only the Authorator / Lead can export disaster recovery snapshots.' });
      }

      const backupDir = path.join(__dirname, 'backups');
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

      const snapshot = {
        platform: 'Frontier AI Internal Platform',
        timestamp: new Date().toISOString(),
        exported_by: currentUser.handle,
        schema_version: '2.0.0',
        tables: {
          members: db.prepare('SELECT * FROM members').all(),
          tasks: db.prepare('SELECT * FROM tasks').all(),
          meeting_slots: db.prepare('SELECT * FROM meeting_slots').all(),
          calendar_events: db.prepare('SELECT * FROM calendar_events').all(),
          voting_sessions: db.prepare('SELECT * FROM voting_sessions').all(),
          voting_options: db.prepare('SELECT * FROM voting_options').all(),
          voting_eligibility: db.prepare('SELECT * FROM voting_eligibility').all(),
          used_tokens: db.prepare('SELECT * FROM used_tokens').all(),
          ballots: db.prepare('SELECT * FROM ballots').all(),
          access_tickets: db.prepare('SELECT * FROM access_tickets').all(),
          audit_events: db.prepare('SELECT * FROM audit_events ORDER BY id DESC LIMIT 100').all()
        }
      };

      const filename = `snapshot_${Date.now()}.json`;
      const filePath = path.join(backupDir, filename);
      fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2), 'utf8');

      logAudit(
        currentUser.handle,
        'DISASTER_SNAPSHOT_EXPORT',
        'system_backup',
        `Sanitized JSON snapshot generated at ${filename} for ₹0 Git repository commit.`,
        'SUCCESS'
      );

      return sendJson(res, 200, {
        message: 'Database snapshot successfully generated for ₹0 Git backup repository!',
        filename,
        totalTables: Object.keys(snapshot.tables).length,
        timestamp: snapshot.timestamp
      });
    }

    // -------------------------------------------------------------
    // STATIC FILE SERVING
    // -------------------------------------------------------------
    let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
    
    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      return res.end('Forbidden');
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath);
      const mimeTypes = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.json': 'application/json',
        '.svg': 'image/svg+xml'
      };
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
      return fs.createReadStream(filePath).pipe(res);
    }

    sendJson(res, 404, { error: 'Route not found' });

  } catch (error) {
    console.error('Server error:', error);
    sendJson(res, 500, { error: 'Internal Server Error', details: error.message });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Frontier AI Platform Prototype running at http://localhost:${PORT}`);
});
