import { db, logAudit } from '../db.js';
import { getSessionUser } from '../middleware/session.js';
import { parseBody, sendJson } from '../middleware/httpHelpers.js';
import { chatWithAssistant } from '../services/aiService.js';

export async function handleAiRoutes(req, res, pathname, method) {
  // 1. Post a new message to the AI Chatbot
  if (pathname === '/api/ai/chat' && method === 'POST') {
    const currentUser = getSessionUser(req);
    if (!currentUser) {
      return sendJson(res, 401, { error: 'Authentication required to consult Frontier Oracle.' });
    }

    try {
      const body = await parseBody(req);
      const { message, threadId } = body;

      if (!message || !message.trim()) {
        return sendJson(res, 400, { error: 'Message text cannot be empty.' });
      }

      const result = await chatWithAssistant({
        userMessage: message,
        threadId,
        currentUser
      });

      logAudit(
        currentUser.handle,
        'AI_ORACLE_QUERY',
        `ai_thread_${result.threadId}`,
        `Queried Frontier Oracle in thread #${result.threadId}: "${message.trim().substring(0, 40)}..."`,
        'SUCCESS'
      );

      return sendJson(res, 200, result);
    } catch (err) {
      console.error('AI Oracle Error:', err);
      return sendJson(res, 500, { error: err.message || 'AI Oracle encountered an error.' });
    }
  }

  // 2. List user's conversation threads
  if (pathname === '/api/ai/threads' && method === 'GET') {
    const currentUser = getSessionUser(req);
    if (!currentUser) return sendJson(res, 401, { error: 'Authentication required' });

    const threads = db.prepare(`
      SELECT id, title, created_at, updated_at
      FROM ai_threads
      WHERE member_id = ?
      ORDER BY updated_at DESC
      LIMIT 20
    `).all(currentUser.id);

    return sendJson(res, 200, { threads });
  }

  // 3. Get message history for a specific thread
  if (pathname.match(/^\/api\/ai\/threads\/\d+\/messages$/) && method === 'GET') {
    const currentUser = getSessionUser(req);
    if (!currentUser) return sendJson(res, 401, { error: 'Authentication required' });

    const threadId = parseInt(pathname.split('/')[4], 10);
    const thread = db.prepare('SELECT * FROM ai_threads WHERE id = ?').get(threadId);

    if (!thread) return sendJson(res, 404, { error: 'Thread not found' });
    if (thread.member_id !== currentUser.id && !currentUser.is_host) {
      return sendJson(res, 403, { error: 'Forbidden: Access to another member\'s chat history is restricted.' });
    }

    const messages = db.prepare(`
      SELECT id, sender_role, content, created_at
      FROM ai_messages
      WHERE thread_id = ?
      ORDER BY id ASC
    `).all(threadId);

    return sendJson(res, 200, { thread, messages });
  }

  // 4. Delete a conversation thread
  if (pathname.match(/^\/api\/ai\/threads\/\d+$/) && method === 'DELETE') {
    const currentUser = getSessionUser(req);
    if (!currentUser) return sendJson(res, 401, { error: 'Authentication required' });

    const threadId = parseInt(pathname.split('/')[4], 10);
    const thread = db.prepare('SELECT * FROM ai_threads WHERE id = ?').get(threadId);

    if (!thread) return sendJson(res, 404, { error: 'Thread not found' });
    if (thread.member_id !== currentUser.id && !currentUser.is_host) {
      return sendJson(res, 403, { error: 'Forbidden' });
    }

    // Delete messages and thread
    db.prepare('DELETE FROM ai_messages WHERE thread_id = ?').run(threadId);
    db.prepare('DELETE FROM ai_threads WHERE id = ?').run(threadId);
    return sendJson(res, 200, { success: true, message: 'Thread deleted successfully' });
  }

  // 5. Delete all conversation threads for current user
  if (pathname === '/api/ai/threads' && method === 'DELETE') {
    const currentUser = getSessionUser(req);
    if (!currentUser) return sendJson(res, 401, { error: 'Authentication required' });

    db.prepare('DELETE FROM ai_messages WHERE thread_id IN (SELECT id FROM ai_threads WHERE member_id = ?)').run(currentUser.id);
    db.prepare('DELETE FROM ai_threads WHERE member_id = ?').run(currentUser.id);
    return sendJson(res, 200, { success: true, message: 'All conversation threads cleared.' });
  }

  return false;
}
