// ==============================================================================
// FRONTIER AI — CLOUDFLARE PAGES FUNCTIONS EDGE ROUTER
// Unified Serverless API running on Cloudflare Edge with D1 Database (env.DB)
// ==============================================================================

// Helper: JSON response with CORS & Security headers
function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    }
  });
}

// Helper: Parse cookies from request header
function parseCookies(request) {
  const cookieHeader = request.headers.get('Cookie') || '';
  const cookies = {};
  cookieHeader.split(';').forEach(cookie => {
    const parts = cookie.split('=');
    if (parts.length >= 2) {
      cookies[parts[0].trim()] = decodeURIComponent(parts.slice(1).join('=').trim());
    }
  });
  return cookies;
}

// Helper: Web Crypto HMAC-SHA256 for Blind Ballot Signatures
async function hmacSha256(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret || 'default-secret-32-chars-minimum-key!'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Helper: SHA256 Hash
async function sha256(message) {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(message));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Helper: Authenticate session from D1
async function getAuthMember(request, env) {
  const cookies = parseCookies(request);
  const token = cookies.frontier_session;
  if (!token || !env.DB) return null;

  try {
    const session = await env.DB.prepare(
      "SELECT member_id FROM sessions WHERE token = ? AND expires_at > datetime('now')"
    ).bind(token).first();

    if (!session) return null;

    const member = await env.DB.prepare(
      'SELECT id, github_numeric_id, handle, name, role, team_track, is_host, is_allowed FROM members WHERE id = ? AND is_allowed = 1'
    ).bind(session.member_id).first();

    return member || null;
  } catch (err) {
    console.error('Session auth error:', err);
    return null;
  }
}

// Helper: Log audit events to D1
async function logAudit(env, actorHandle, action, target, details, status = 'SUCCESS') {
  if (!env.DB) return;
  try {
    await env.DB.prepare(
      'INSERT INTO audit_events (timestamp, actor_handle, action, target, details, status) VALUES (datetime(\'now\'), ?, ?, ?, ?, ?)'
    ).bind(actorHandle, action, target, details, status).run();
  } catch (e) {
    console.error('Audit log error:', e);
  }
}

// Main Edge Dispatcher
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const pathname = url.pathname;
  const method = request.method;

  if (!env.DB) {
    return jsonResponse({ error: 'Cloudflare D1 binding [DB] is missing. Please bind your D1 database in Pages Settings.' }, 500);
  }

  try {
    // --------------------------------------------------------------------------
    // 1. AUTHENTICATION & SESSIONS
    // --------------------------------------------------------------------------
    if (pathname === '/api/auth/session' && method === 'GET') {
      const member = await getAuthMember(request, env);
      return jsonResponse({
        authenticated: !!member,
        member: member || null
      });
    }

    if (pathname === '/api/auth/github' && method === 'GET') {
      const clientId = env.GITHUB_CLIENT_ID;
      if (!clientId) {
        return jsonResponse({ error: 'GITHUB_CLIENT_ID not configured on Cloudflare' }, 500);
      }
      const redirectUri = `${url.origin}/api/auth/github/callback`;
      const githubUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user`;
      return Response.redirect(githubUrl, 302);
    }

    if (pathname === '/api/auth/github/callback' && method === 'GET') {
      const code = url.searchParams.get('code');
      if (!code) return Response.redirect(`${url.origin}/?error=no_code`, 302);

      const clientId = env.GITHUB_CLIENT_ID;
      const clientSecret = env.GITHUB_CLIENT_SECRET;

      // Exchange code for GitHub token
      const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code
        })
      });
      const tokenData = await tokenRes.json();
      if (!tokenData.access_token) {
        return Response.redirect(`${url.origin}/?error=token_exchange_failed`, 302);
      }

      // Fetch user profile from GitHub
      const userRes = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
          'User-Agent': 'FrontierAI-Pages'
        }
      });
      const ghUser = await userRes.json();

      // Check allowlist in D1
      const member = await env.DB.prepare(
        'SELECT * FROM members WHERE (github_numeric_id = ? OR lower(handle) = lower(?)) AND is_allowed = 1'
      ).bind(ghUser.id, ghUser.login).first();

      if (!member) {
        await logAudit(env, ghUser.login || 'UNKNOWN', 'AUTH_LOGIN', 'auth', 'Unauthorized GitHub login attempt rejected', 'DENIED');
        return Response.redirect(`${url.origin}/?error=not_authorized`, 302);
      }

      // Generate Session Token
      const sessionToken = crypto.randomUUID() + '-' + crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 86400000 * 7).toISOString();

      await env.DB.prepare(
        'INSERT INTO sessions (token, member_id, created_at, expires_at) VALUES (?, ?, datetime(\'now\'), ?)'
      ).bind(sessionToken, member.id, expiresAt).run();

      await logAudit(env, member.handle, 'AUTH_LOGIN', 'auth', 'Real GitHub OAuth login succeeded', 'SUCCESS');

      // Return 302 Redirect with Set-Cookie
      const cookieHeader = `frontier_session=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`;
      return new Response(null, {
        status: 302,
        headers: {
          'Location': `${url.origin}/`,
          'Set-Cookie': cookieHeader
        }
      });
    }

    if (pathname === '/api/auth/logout' && method === 'POST') {
      const cookies = parseCookies(request);
      if (cookies.frontier_session) {
        await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(cookies.frontier_session).run();
      }
      return jsonResponse({ success: true }, 200, {
        'Set-Cookie': 'frontier_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'
      });
    }

    // --------------------------------------------------------------------------
    // 2. DASHBOARD & STATS
    // --------------------------------------------------------------------------
    if (pathname === '/api/dashboard/stats' && method === 'GET') {
      const member = await getAuthMember(request, env);
      const memberId = member ? member.id : 1;

      const tasksCount = await env.DB.prepare(
        'SELECT status, count(*) as count FROM tasks WHERE assignee_id = ? GROUP BY status'
      ).bind(memberId).all();

      const taskletsCount = await env.DB.prepare(
        'SELECT status, count(*) as count FROM tasklets WHERE receiver_id = ? GROUP BY status'
      ).bind(memberId).all();

      const events = await env.DB.prepare(`
        SELECT c.*, m.handle as creator_handle, s.slot_name
        FROM calendar_events c
        LEFT JOIN members m ON c.created_by = m.id
        LEFT JOIN meeting_slots s ON c.meeting_slot_id = s.id
        ORDER BY c.event_date ASC
      `).all();

      return jsonResponse({
        tasksStats: tasksCount.results || [],
        taskletsStats: taskletsCount.results || [],
        events: events.results || []
      });
    }

    // --------------------------------------------------------------------------
    // 3. MEMBERS ROSTER
    // --------------------------------------------------------------------------
    if (pathname === '/api/members' && method === 'GET') {
      const res = await env.DB.prepare(
        'SELECT id, github_numeric_id, handle, name, role, team_track, is_host, is_allowed FROM members WHERE is_allowed = 1'
      ).all();
      return jsonResponse({ members: res.results || [] });
    }

    // --------------------------------------------------------------------------
    // 4. TASKS BOARD
    // --------------------------------------------------------------------------
    if (pathname === '/api/tasks' && method === 'GET') {
      const res = await env.DB.prepare(`
        SELECT t.*, m.name as assignee_name, m.handle as assignee_handle
        FROM tasks t
        LEFT JOIN members m ON t.assignee_id = m.id
        ORDER BY t.id DESC
      `).all();
      return jsonResponse({ tasks: res.results || [] });
    }

    if (pathname === '/api/tasks' && method === 'POST') {
      const member = await getAuthMember(request, env);
      if (!member || !member.is_host) {
        return jsonResponse({ error: 'Only Team Host can create sprint tasks' }, 403);
      }
      const body = await request.json();
      const { title, description, track, assignee_id, deadline } = body;
      const res = await env.DB.prepare(`
        INSERT INTO tasks (title, description, track, assignee_id, status, deadline, version, updated_at)
        VALUES (?, ?, ?, ?, 'TODO', ?, 1, datetime('now'))
      `).bind(title, description || '', track || 'general', assignee_id || null, deadline || null).run();

      await logAudit(env, member.handle, 'TASK_CREATE', 'tasks', `Task #${res.meta?.last_row_id} created`);
      return jsonResponse({ success: true, taskId: res.meta?.last_row_id }, 201);
    }

    if (pathname.startsWith('/api/tasks/') && method === 'PATCH') {
      const member = await getAuthMember(request, env);
      if (!member) return jsonResponse({ error: 'Unauthorized' }, 401);
      const taskId = pathname.split('/')[3];
      const body = await request.json();
      const { status, deliverable_url, deliverable_notes, version } = body;

      const existing = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(taskId).first();
      if (!existing) return jsonResponse({ error: 'Task not found' }, 404);

      if (version !== undefined && existing.version !== version) {
        return jsonResponse({
          error: 'OCC Conflict: This task was modified by another teammate. Please refresh.',
          code: 'CONCURRENCY_CONFLICT'
        }, 409);
      }

      await env.DB.prepare(`
        UPDATE tasks
        SET status = COALESCE(?, status),
            deliverable_url = COALESCE(?, deliverable_url),
            deliverable_notes = COALESCE(?, deliverable_notes),
            version = version + 1,
            updated_at = datetime('now')
        WHERE id = ?
      `).bind(status || null, deliverable_url || null, deliverable_notes || null, taskId).run();

      await logAudit(env, member.handle, 'TASK_UPDATE', 'tasks', `Task #${taskId} updated to ${status || existing.status}`);
      return jsonResponse({ success: true });
    }

    // --------------------------------------------------------------------------
    // 5. MEETINGS & BRIDGES (PATH A)
    // --------------------------------------------------------------------------
    if (pathname === '/api/meetings/slots' && method === 'GET') {
      const res = await env.DB.prepare('SELECT id, slot_code, slot_name, last_used_at FROM meeting_slots').all();
      return jsonResponse({ slots: res.results || [] });
    }

    if (pathname.startsWith('/api/meetings/join/') && method === 'GET') {
      const member = await getAuthMember(request, env);
      if (!member) return Response.redirect(`${url.origin}/?error=unauthorized`, 302);
      const slotId = pathname.split('/')[4];
      const slot = await env.DB.prepare('SELECT * FROM meeting_slots WHERE id = ?').bind(slotId).first();
      if (!slot) return jsonResponse({ error: 'Slot not found' }, 404);

      await env.DB.prepare('UPDATE meeting_slots SET last_used_at = datetime(\'now\') WHERE id = ?').bind(slotId).run();
      await logAudit(env, member.handle, 'MEETING_JOIN', 'meetings', `Joined ${slot.slot_name}`);
      return Response.redirect(slot.raw_url, 302);
    }

    // --------------------------------------------------------------------------
    // 6. CALENDAR & LIVE PINGS
    // --------------------------------------------------------------------------
    if (pathname === '/api/calendar/events' && method === 'GET') {
      const res = await env.DB.prepare(`
        SELECT c.*, m.handle as creator_handle, s.slot_name
        FROM calendar_events c
        LEFT JOIN members m ON c.created_by = m.id
        LEFT JOIN meeting_slots s ON c.meeting_slot_id = s.id
        ORDER BY c.event_date ASC
      `).all();
      return jsonResponse({ events: res.results || [] });
    }

    // --------------------------------------------------------------------------
    // 7. CRYPTOGRAPHIC BLIND PEER REVIEW (VOTING)
    // --------------------------------------------------------------------------
    if (pathname === '/api/voting/sessions' && method === 'GET') {
      const sessions = await env.DB.prepare(`
        SELECT s.*, count(b.id) as votes_cast
        FROM voting_sessions s
        LEFT JOIN ballots b ON s.id = b.session_id
        GROUP BY s.id
        ORDER BY s.id DESC
      `).all();

      const options = await env.DB.prepare(`
        SELECT o.*, m.name as candidate_name, m.handle as candidate_handle
        FROM voting_options o
        LEFT JOIN members m ON o.candidate_member_id = m.id
      `).all();

      return jsonResponse({
        sessions: sessions.results || [],
        options: options.results || []
      });
    }

    if (pathname === '/api/voting/collect-token' && method === 'POST') {
      const member = await getAuthMember(request, env);
      if (!member) return jsonResponse({ error: 'Unauthorized' }, 401);
      const { session_id } = await request.json();

      const session = await env.DB.prepare('SELECT * FROM voting_sessions WHERE id = ? AND status = \'ACTIVE\'').bind(session_id).first();
      if (!session) return jsonResponse({ error: 'Voting session is not active' }, 400);

      // Check eligibility
      const alreadyClaimed = await env.DB.prepare(
        'SELECT * FROM voting_eligibility WHERE session_id = ? AND member_id = ?'
      ).bind(session_id, member.id).first();

      if (alreadyClaimed) {
        return jsonResponse({ error: 'Ballot token already claimed for this session' }, 400);
      }

      // Mark eligibility claimed
      await env.DB.prepare(
        'INSERT INTO voting_eligibility (session_id, member_id, token_issued_at) VALUES (?, ?, datetime(\'now\'))'
      ).bind(session_id, member.id).run();

      // Issue Blind HMAC Token (detached from identity!)
      const nonce = crypto.randomUUID();
      const message = `${session_id}:${nonce}`;
      const signature = await hmacSha256(env.VOTING_SECRET || 'secret-salt-key-minimum-32-chars', message);
      const blindToken = `${message}:${signature}`;

      await logAudit(env, member.handle, 'VOTE_CLAIM_TOKEN', 'voting', `Blind token claimed for Session #${session_id}`);
      return jsonResponse({ token: blindToken });
    }

    if (pathname === '/api/voting/cast' && method === 'POST') {
      const { token, session_id, option_id } = await request.json();
      if (!token || !session_id || !option_id) {
        return jsonResponse({ error: 'Missing token or ballot payload' }, 400);
      }

      // Verify HMAC
      const parts = token.split(':');
      if (parts.length !== 3) return jsonResponse({ error: 'Malformed blind ballot token' }, 400);
      const [tokenSessionId, nonce, providedSig] = parts;

      if (parseInt(tokenSessionId, 10) !== parseInt(session_id, 10)) {
        return jsonResponse({ error: 'Token is for a different voting session' }, 400);
      }

      const expectedSig = await hmacSha256(env.VOTING_SECRET || 'secret-salt-key-minimum-32-chars', `${tokenSessionId}:${nonce}`);
      if (expectedSig !== providedSig) {
        return jsonResponse({ error: 'Cryptographic token validation failed: Signature forged' }, 403);
      }

      // Prevent double spend via token hash
      const tokenHash = await sha256(token);
      const used = await env.DB.prepare('SELECT * FROM used_tokens WHERE token_hash = ?').bind(tokenHash).first();
      if (used) {
        return jsonResponse({ error: 'Double-spending rejected: This ballot token was already cast' }, 409);
      }

      // Record ballot in anonymized box (ZERO member identity linkage!)
      await env.DB.prepare('INSERT INTO used_tokens (token_hash, used_at) VALUES (?, datetime(\'now\'))').bind(tokenHash).run();
      await env.DB.prepare('INSERT INTO ballots (session_id, option_id) VALUES (?, ?)').bind(session_id, option_id).run();

      await logAudit(env, 'ANONYMOUS_VOTER', 'VOTE_CAST', 'voting', `Anonymous ballot cast in Session #${session_id}`);
      return jsonResponse({ success: true });
    }

    // --------------------------------------------------------------------------
    // 8. PEER TASKLETS
    // --------------------------------------------------------------------------
    if (pathname === '/api/tasklets' && method === 'GET') {
      const member = await getAuthMember(request, env);
      const memberId = member ? member.id : 1;

      const res = await env.DB.prepare(`
        SELECT t.*, s.handle as sender_handle, s.name as sender_name, r.handle as receiver_handle, r.name as receiver_name
        FROM tasklets t
        LEFT JOIN members s ON t.sender_id = s.id
        LEFT JOIN members r ON t.receiver_id = r.id
        WHERE t.sender_id = ? OR t.receiver_id = ?
        ORDER BY t.id DESC
      `).bind(memberId, memberId).all();

      return jsonResponse({ tasklets: res.results || [] });
    }

    // --------------------------------------------------------------------------
    // 9. GOVERNANCE & TWO-PERSON RULE TICKETS
    // --------------------------------------------------------------------------
    if (pathname === '/api/governance/tickets' && method === 'GET') {
      const res = await env.DB.prepare(`
        SELECT a.*, r.handle as requester_handle, ap.handle as approver_handle
        FROM access_tickets a
        LEFT JOIN members r ON a.requester_id = r.id
        LEFT JOIN members ap ON a.approver_id = ap.id
        ORDER BY a.id DESC
      `).all();
      return jsonResponse({ tickets: res.results || [] });
    }

    // --------------------------------------------------------------------------
    // 10. AUDIT LOGS
    // --------------------------------------------------------------------------
    if (pathname === '/api/audit/logs' && method === 'GET') {
      const res = await env.DB.prepare('SELECT * FROM audit_events ORDER BY id DESC LIMIT 100').all();
      return jsonResponse({ logs: res.results || [] });
    }

    // --------------------------------------------------------------------------
    // 11. FRONTIER ORACLE AI ASSISTANT (GOOGLE GEMINI 1.5 FLASH + D1 MEMORY)
    // --------------------------------------------------------------------------
    if (pathname === '/api/ai/chat' && method === 'POST') {
      const member = await getAuthMember(request, env);
      const memberId = member ? member.id : 1;
      const { message, threadId } = await request.json();

      if (!message || !message.trim()) {
        return jsonResponse({ error: 'Message cannot be empty' }, 400);
      }

      // Ensure thread exists
      let activeThreadId = threadId;
      if (!activeThreadId) {
        const title = message.slice(0, 40) + '...';
        const threadRes = await env.DB.prepare(
          'INSERT INTO ai_threads (member_id, title, created_at, updated_at) VALUES (?, ?, datetime(\'now\'), datetime(\'now\'))'
        ).bind(memberId, title).run();
        activeThreadId = threadRes.meta?.last_row_id;
      }

      // Record User Message
      await env.DB.prepare(
        'INSERT INTO ai_messages (thread_id, sender_role, content, created_at) VALUES (?, \'user\', ?, datetime(\'now\'))'
      ).bind(activeThreadId, message).run();

      // Retrieve Tier 1 Context from D1 (Tasks, Meetings, Memory)
      const tasks = await env.DB.prepare('SELECT title, track, status, deadline FROM tasks LIMIT 10').all();
      const slots = await env.DB.prepare('SELECT slot_name, slot_code FROM meeting_slots LIMIT 6').all();
      const memory = await env.DB.prepare('SELECT memory_data FROM member_memories WHERE member_id = ?').bind(memberId).first();

      const systemPrompt = `You are Frontier Oracle, the AI project assistant for Frontier AI engineering workspace.
Current User: ${member ? member.name + ' (@' + member.handle + ')' : 'Guest Engineer'}
User Memory: ${memory?.memory_data || '{}'}
Active Sprint Tasks:
${(tasks.results || []).map(t => `- [${t.status}] ${t.title} (${t.track})`).join('\n')}
Meeting Bridges:
${(slots.results || []).map(s => `- ${s.slot_name} (${s.slot_code})`).join('\n')}
Answer questions authoritatively, concisely, and accurately based on the workspace data above.`;

      let modelReply = '';

      // Check if Google Gemini API Key exists
      if (env.GEMINI_API_KEY) {
        try {
          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.GEMINI_API_KEY}`;
          const geminiRes = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [
                { role: 'user', parts: [{ text: `${systemPrompt}\n\nUser Question: ${message}` }] }
              ],
              generationConfig: { maxOutputTokens: 1000, temperature: 0.3 }
            })
          });
          const geminiData = await geminiRes.json();
          modelReply = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
        } catch (e) {
          console.error('Gemini error:', e);
        }
      }

      // Intelligent Offline Fallback if no key or error
      if (!modelReply) {
        const lower = message.toLowerCase();
        if (lower.includes('task') || lower.includes('todo') || lower.includes('sprint')) {
          modelReply = `Here are the active workspace tasks from Cloudflare D1:\n` +
            (tasks.results || []).map(t => `• **${t.title}** — \`${t.status}\` (${t.track})`).join('\n');
        } else if (lower.includes('meet') || lower.includes('call') || lower.includes('bridge')) {
          modelReply = `Frontier AI operates 6 pre-configured Google Meet bridges:\n` +
            (slots.results || []).map(s => `• **${s.slot_name}** (\`${s.slot_code}\`)`).join('\n');
        } else {
          modelReply = `I am Frontier Oracle running live on Cloudflare Edge & D1. You have ${(tasks.results || []).length} sprint tasks and ${(slots.results || []).length} meeting bridges configured. How can I assist you with your deliverables?`;
        }
      }

      // Record Model Reply
      await env.DB.prepare(
        'INSERT INTO ai_messages (thread_id, sender_role, content, created_at) VALUES (?, \'model\', ?, datetime(\'now\'))'
      ).bind(activeThreadId, modelReply).run();

      return jsonResponse({
        reply: modelReply,
        threadId: activeThreadId
      });
    }

    if (pathname === '/api/ai/threads' && method === 'GET') {
      const member = await getAuthMember(request, env);
      const memberId = member ? member.id : 1;
      const res = await env.DB.prepare('SELECT * FROM ai_threads WHERE member_id = ? ORDER BY id DESC').bind(memberId).all();
      return jsonResponse({ threads: res.results || [] });
    }

    // Default 404 for unhandled API routes
    return jsonResponse({ error: 'Not Found', path: pathname }, 404);

  } catch (err) {
    console.error('Cloudflare Edge Function unhandled error:', err);
    return jsonResponse({ error: err.message || 'Internal Server Error' }, 500);
  }
}
