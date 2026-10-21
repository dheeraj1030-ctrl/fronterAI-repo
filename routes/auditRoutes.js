import { db } from '../db.js';
import { getSessionUser } from '../middleware/session.js';
import { sendJson } from '../middleware/httpHelpers.js';

export async function handleAuditRoutes(req, res, pathname, method) {
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

  return false;
}
