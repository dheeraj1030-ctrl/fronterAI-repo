import crypto from 'node:crypto';
import { db, logAudit } from '../db.js';
import { getSessionUser, createSession, destroySession } from '../middleware/session.js';
import { parseCookies, parseBody, sendJson } from '../middleware/httpHelpers.js';
import { BASE_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, isProduction } from '../config.js';

export async function handleAuthRoutes(req, res, pathname, method, urlObj) {
  const cookies = parseCookies(req);

  if (pathname === '/api/auth/current' && method === 'GET') {
    const currentUser = getSessionUser(req);
    return sendJson(res, 200, { user: currentUser, oauthConfigured: !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) });
  }

  // -------------------------------------------------------------
  // GOOGLE OAUTH 2.0 FLOW
  // -------------------------------------------------------------
  if (pathname === '/api/auth/google' && method === 'GET') {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      res.writeHead(302, { Location: '/?error=oauth_not_configured' });
      return res.end();
    }

    const state = crypto.randomBytes(16).toString('hex');
    const redirectUri = `${BASE_URL}/api/auth/google/callback`;
    const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${GOOGLE_CLIENT_ID}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&response_type=code` +
      `&scope=${encodeURIComponent('openid email profile')}` +
      `&access_type=offline` +
      `&state=${state}`;

    res.writeHead(302, {
      'Location': googleAuthUrl,
      'Set-Cookie': `oauth_state=${state}; HttpOnly; Path=/; SameSite=Lax; Max-Age=600`
    });
    return res.end();
  }

  if (pathname === '/api/auth/google/callback' && method === 'GET') {
    const code = urlObj.searchParams.get('code');
    const state = urlObj.searchParams.get('state');
    const oauthError = urlObj.searchParams.get('error');

    if (oauthError) {
      res.writeHead(302, { Location: `/?error=${encodeURIComponent(oauthError)}` });
      return res.end();
    }

    if (!state || state !== cookies.oauth_state) {
      logAudit('anonymous', 'OAUTH_CSRF_FAILED', 'auth_oauth', 'Google OAuth state parameter mismatch or missing state cookie.', 'DENIED');
      res.writeHead(302, { Location: '/?error=csrf_state_mismatch' });
      return res.end();
    }

    try {
      // Exchange code for Google access token
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          redirect_uri: `${BASE_URL}/api/auth/google/callback`,
          grant_type: 'authorization_code'
        }).toString()
      });

      const tokenData = await tokenRes.json();
      if (!tokenData.access_token) {
        logAudit('anonymous', 'OAUTH_TOKEN_FAILED', 'auth_oauth', `Google token exchange failed: ${tokenData.error_description || 'unknown'}`, 'DENIED');
        res.writeHead(302, { Location: '/?error=token_exchange_failed' });
        return res.end();
      }

      // Fetch Google user profile
      const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
      });
      const googleUser = await userRes.json();
      const googleSub = googleUser.sub;   // Stable unique Google user ID
      const googleEmail = googleUser.email;

      // Check allowlist: match by google_sub (returning users) OR email (first login)
      let member = db.prepare('SELECT * FROM members WHERE google_sub = ?').get(googleSub);
      if (!member) {
        member = db.prepare('SELECT * FROM members WHERE LOWER(email) = LOWER(?) AND is_allowed = 1').get(googleEmail);
        // On first login: bind google_sub to the allowlisted email record
        if (member) {
          db.prepare('UPDATE members SET google_sub = ? WHERE id = ?').run(googleSub, member.id);
          member = db.prepare('SELECT * FROM members WHERE id = ?').get(member.id);
        }
      }

      if (!member || !member.is_allowed) {
        logAudit(
          `google_${googleEmail || googleSub}`,
          'OAUTH_ALLOWLIST_DENIED',
          'auth_allowlist',
          `Google account ${googleEmail} authenticated via Google OAuth but is NOT in the Frontier AI allowlist.`,
          'DENIED'
        );
        res.writeHead(302, {
          Location: `/?error=unauthorized_allowlist&email=${encodeURIComponent(googleEmail || '')}`
        });
        return res.end();
      }

      const sessionToken = createSession(member);
      logAudit(
        member.handle,
        'OAUTH_LOGIN_SUCCESS',
        'auth_session',
        `Authenticated via Google OAuth 2.0 as ${member.name} (${googleEmail}). Access level: ${member.is_host ? 'AUTHORATOR' : 'PARTICIPANT'}.`,
        'SUCCESS'
      );

      res.writeHead(302, {
        'Location': '/?auth=oauth_success',
        'Set-Cookie': `frontier_session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`
      });
      return res.end();

    } catch (err) {
      console.error('Google OAuth callback error:', err);
      res.writeHead(302, { Location: '/?error=oauth_internal_error' });
      return res.end();
    }
  }

  // Dev Simulation Endpoint (localhost only)
  if (pathname === '/api/auth/google/simulate' && method === 'GET') {
    if (isProduction) {
      return sendJson(res, 404, { error: 'Not found' });
    }
    const email = urlObj.searchParams.get('email') || 'kart123.san@gmail.com';
    const member = db.prepare('SELECT * FROM members WHERE LOWER(email) = LOWER(?) AND is_allowed = 1').get(email);

    if (!member || !member.is_allowed) {
      logAudit(
        `google_${email}`,
        'OAUTH_SIM_DENIED',
        'auth_allowlist',
        `Simulated Google OAuth login rejected for email: ${email}. Not in allowlist.`,
        'DENIED'
      );
      res.writeHead(302, { Location: `/?error=unauthorized_allowlist&email=${encodeURIComponent(email)}` });
      return res.end();
    }

    const sessionToken = createSession(member);
    logAudit(
      member.handle,
      'OAUTH_SIM_SUCCESS',
      'auth_session',
      `Simulated Google OAuth callback verified for ${member.name} (${email}).`,
      'SUCCESS'
    );
    res.writeHead(302, {
      'Location': '/?auth=oauth_success',
      'Set-Cookie': `frontier_session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`
    });
    return res.end();
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

  return false;
}
