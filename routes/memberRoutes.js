import { db, logAudit } from '../db.js';
import { getSessionUser } from '../middleware/session.js';
import { parseBody, sendJson } from '../middleware/httpHelpers.js';

export async function handleMemberRoutes(req, res, pathname, method) {
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

  if (pathname === '/api/members' && method === 'POST') {
    const currentUser = getSessionUser(req);
    if (!currentUser || !currentUser.is_host) {
      logAudit(currentUser ? currentUser.handle : 'unauthenticated', 'MEMBER_ONBOARD_DENIED', 'members', 'Unauthorized attempt to onboard a team member.', 'DENIED');
      return sendJson(res, 403, { error: 'Forbidden: Only the Team Host can onboard members.' });
    }

    const body = await parseBody(req);
    const { github_username, role, team_track } = body;

    if (!github_username || !role) {
      return sendJson(res, 400, { error: 'GitHub username and role are required.' });
    }

    const sanitizedUsername = String(github_username).trim().replace(/^@/, '');
    if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/.test(sanitizedUsername)) {
      return sendJson(res, 400, { error: 'Invalid GitHub username format.' });
    }

    // Check if user already exists
    const existing = db.prepare('SELECT id, handle FROM members WHERE LOWER(handle) = LOWER(?)').get(sanitizedUsername);
    if (existing) {
      return sendJson(res, 409, { error: `Member @${sanitizedUsername} is already registered in the allowlist.` });
    }

    try {
      // Query GitHub public API to verify user and retrieve immutable numeric ID
      const ghRes = await fetch(`https://api.github.com/users/${encodeURIComponent(sanitizedUsername)}`, {
        headers: { 'User-Agent': 'FrontierAI-Workspace' }
      });

      if (!ghRes.ok) {
        return sendJson(res, 404, { error: `GitHub user @${sanitizedUsername} was not found on GitHub.` });
      }

      const ghData = await ghRes.json();
      const numericId = ghData.id;
      const displayName = ghData.name || sanitizedUsername;
      const validTrack = ['frontend', 'backend', 'lead'].includes(team_track) ? team_track : 'backend';

      // Secure Parameterized Insert: Completely immune to SQL injection
      const insertStmt = db.prepare(`
        INSERT INTO members (github_numeric_id, handle, name, role, team_track, is_host, is_allowed)
        VALUES (?, ?, ?, ?, ?, 0, 1)
      `);
      const result = insertStmt.run(numericId, sanitizedUsername, displayName, String(role).trim(), validTrack);

      logAudit(
        currentUser.handle,
        'MEMBER_ONBOARDED',
        'members',
        `Onboarded @${sanitizedUsername} (${displayName}, GitHub ID: ${numericId}) as ${role} [${validTrack}].`,
        'SUCCESS'
      );

      const newMember = db.prepare('SELECT id, github_numeric_id, handle, name, role, team_track, is_host, is_allowed FROM members WHERE id = ?').get(result.lastInsertRowid);
      return sendJson(res, 201, { member: newMember, message: `Successfully onboarded @${sanitizedUsername} to Frontier AI allowlist.` });
    } catch (err) {
      console.error('Failed to onboard GitHub member:', err);
      return sendJson(res, 500, { error: 'Failed to query GitHub API or store member.' });
    }
  }

  if (pathname.startsWith('/api/members/') && method === 'DELETE') {
    const currentUser = getSessionUser(req);
    if (!currentUser || !currentUser.is_host) {
      return sendJson(res, 403, { error: 'Forbidden: Only the Team Host can remove members.' });
    }
    const memberId = parseInt(pathname.split('/')[3], 10);
    if (isNaN(memberId)) {
      return sendJson(res, 400, { error: 'Invalid member ID.' });
    }
    if (memberId === currentUser.id) {
      return sendJson(res, 400, { error: 'Host cannot remove themselves from the allowlist.' });
    }
    const targetMember = db.prepare('SELECT id, handle, name FROM members WHERE id = ?').get(memberId);
    if (!targetMember) {
      return sendJson(res, 404, { error: 'Member not found.' });
    }
    db.prepare('DELETE FROM members WHERE id = ?').run(memberId);
    logAudit(currentUser.handle, 'MEMBER_REMOVED', 'members', `Removed member @${targetMember.handle} (${targetMember.name}, ID: ${memberId}) from allowlist.`, 'SUCCESS');
    return sendJson(res, 200, { message: `Member @${targetMember.handle} removed successfully.` });
  }

  return false;
}
