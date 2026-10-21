import crypto from 'node:crypto';
import { db, logAudit } from '../db.js';
import { getSessionUser, createSession, destroySession } from '../middleware/session.js';
import { parseCookies, parseBody, sendJson } from '../middleware/httpHelpers.js';
import { BASE_URL, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, isProduction } from '../config.js';

export async function handleAuthRoutes(req, res, pathname, method, urlObj) {
  const cookies = parseCookies(req);

  if (pathname === '/api/auth/current' && method === 'GET') {
    const currentUser = getSessionUser(req);
    return sendJson(res, 200, { user: currentUser, oauthConfigured: !!(GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET) });
  }

  // -------------------------------------------------------------
  // REAL GITHUB OAUTH 2.0 FLOW
  // -------------------------------------------------------------
  if (pathname === '/api/auth/github' && method === 'GET') {
    if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
      res.writeHead(302, { Location: '/?error=oauth_not_configured' });
      return res.end();
    }

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

      const userRes = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
          'User-Agent': 'FrontierAI-Workspace'
        }
      });

      const ghUser = await userRes.json();
      const numericId = ghUser.id;
      const ghLogin = ghUser.login;

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

  // Dev Simulation Endpoint
  if (pathname === '/api/auth/github/simulate' && method === 'GET') {
    if (isProduction) {
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
    if (isProduction) {
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
    if (isProduction) {
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

  return false;
}
