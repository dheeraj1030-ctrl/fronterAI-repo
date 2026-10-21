import { db, logAudit } from '../db.js';
import { getSessionUser } from '../middleware/session.js';
import { parseBody, sendJson } from '../middleware/httpHelpers.js';

export async function handleTaskletRoutes(req, res, pathname, method) {
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

  return false;
}
