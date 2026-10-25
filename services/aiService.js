import { GEMINI_API_KEY, GROQ_API_KEY, AI_PROVIDER } from '../config.js';
import { db } from '../db.js';

/**
 * Builds a token-optimized, role-sanitized workspace snapshot in compact markdown.
 * Implements intent-based filtering to avoid the "Context Stuffing" token trap.
 */
export function buildWorkspaceContext(db, currentUser, userMessage = '') {
  const text = (userMessage || '').toLowerCase();
  const parts = [];

  // 1. User Identity & Permissions (~20 tokens)
  parts.push(`CURRENT USER: ${currentUser.name} (@${currentUser.handle}) | Role: ${currentUser.role} | Track: ${currentUser.team_track} | Is Host: ${currentUser.is_host ? 'YES' : 'NO'}`);

  // 2. Member Directory (Always compact, ~60 tokens for 8 members)
  const members = db.prepare('SELECT id, name, handle, role, team_track, is_host FROM members WHERE is_allowed = 1 ORDER BY is_host DESC, id ASC').all();
  parts.push("TEAM DIRECTORY:\n" + members.map(m => `- ${m.name} (@${m.handle}): ${m.role} [Track: ${m.team_track || 'General'}]${m.is_host ? ' (Lead)' : ''}`).join("\n"));

  // 3. Dynamic Intent Filter: Tasks (~50-100 tokens only when relevant)
  const taskKeywords = /task|todo|progress|deliverable|deadline|work|sprint|pr|blocked|status/;
  if (taskKeywords.test(text) || text.length < 5) {
    const tasks = db.prepare(`
      SELECT t.id, t.title, t.track, t.status, t.deadline, m.name as assignee
      FROM tasks t
      LEFT JOIN members m ON t.assignee_id = m.id
      ORDER BY t.id ASC LIMIT 15
    `).all();
    if (tasks.length > 0) {
      parts.push("ACTIVE TASKS:\n" + tasks.map(t => `- [${t.status}] #${t.id}: "${t.title}" (Assignee: ${t.assignee || 'Unassigned'}, Due: ${t.deadline || 'None'})`).join("\n"));
    }
  }

  // 4. Dynamic Intent Filter: Calendar & Google Meet Syncs (~50 tokens)
  const calKeywords = /meet|call|sync|calendar|slot|bridge|schedule|google|today|event|retro/;
  if (calKeywords.test(text) || text.length < 5) {
    const events = db.prepare(`
      SELECT title, event_type, event_date, time_label, target_audience, is_live
      FROM calendar_events
      ORDER BY event_date ASC, id ASC LIMIT 5
    `).all();
    if (events.length > 0) {
      parts.push("UPCOMING SYNC EVENTS:\n" + events.map(e => `- [${e.event_type}${e.is_live ? ' LIVE' : ''}] "${e.title}" on ${e.event_date} at ${e.time_label} (Audience: ${e.target_audience})`).join("\n"));
    }
  }

  // 5. Dynamic Intent Filter: Peer Tasklets (~40 tokens)
  const taskletKeywords = /tasklet|peer|request|micro|received|sent/;
  if (taskletKeywords.test(text)) {
    const tasklets = db.prepare(`
      SELECT t.title, t.status, s.name as sender, r.name as receiver
      FROM tasklets t
      JOIN members s ON t.sender_id = s.id
      JOIN members r ON t.receiver_id = r.id
      ORDER BY t.id DESC LIMIT 8
    `).all();
    if (tasklets.length > 0) {
      parts.push("PEER TASKLETS:\n" + tasklets.map(t => `- [${t.status}] "${t.title}" from ${t.sender} to ${t.receiver}`).join("\n"));
    }
  }

  // 6. Role-Gated Admin Context (Host Only)
  if (currentUser.is_host) {
    const ticketKeywords = /ticket|governance|access|permission|request/;
    if (ticketKeywords.test(text)) {
      const tickets = db.prepare(`
        SELECT t.id, t.title, t.reason, t.scope, t.status, req.name as requester
        FROM access_tickets t
        JOIN members req ON t.requester_id = req.id
        WHERE t.status = 'PENDING_APPROVAL'
      `).all();
      if (tickets.length > 0) {
        parts.push("PENDING 2-MAN ACCESS TICKETS (Host Only):\n" + tickets.map(tk => `- #${tk.id} by ${tk.requester}: "${tk.title}" for ${tk.scope}`).join("\n"));
      }
    }
  }

  return parts.join("\n\n");
}

/**
 * Handles multi-turn chat with the AI assistant.
 * Supports Google Gemini 1.5 Flash (default) and Groq Llama 3, with zero external npm dependencies.
 */
export async function chatWithAssistant({ userMessage, threadId, currentUser }) {
  if (!userMessage || !userMessage.trim()) {
    throw new Error('Message cannot be empty.');
  }

  // 1. Get or create thread in SQLite
  let activeThreadId = threadId ? parseInt(threadId, 10) : null;
  if (!activeThreadId) {
    const threadTitle = userMessage.trim().substring(0, 50);
    const result = db.prepare(`
      INSERT INTO ai_threads (member_id, title, created_at, updated_at)
      VALUES (?, ?, datetime('now'), datetime('now'))
    `).run(currentUser.id, threadTitle);
    activeThreadId = result.lastInsertRowid;
  }

  // 2. Fetch conversation history for this thread (sliding window: last 6 turns)
  const history = db.prepare(`
    SELECT sender_role, content FROM ai_messages
    WHERE thread_id = ?
    ORDER BY id ASC
    LIMIT 6
  `).all(activeThreadId);

  // 3. Build dynamic, token-optimized workspace context
  const workspaceContext = buildWorkspaceContext(db, currentUser, userMessage);

  const systemPrompt = `You are Frontier Oracle, the internal AI workspace assistant for the Frontier AI engineering team.
You have live access to the team's project state, tasks, meetings, and team tracks.

WORKSPACE CONTEXT:
${workspaceContext}

GUIDELINES:
1. Provide concise, direct, professional answers grounded strictly in the workspace context above.
2. If asked about Google Meet links, explain that raw links are securely masked behind the internal companion gateway (/api/meetings/join/:id).
3. If asked about anonymous peer evaluations, never speculate or disclose unblinded voter data.
4. Format responses cleanly using markdown (bullet points, bold highlights, backtick code spans).`;

  let replyText = '';

  // 4. Check for active API key
  if (GEMINI_API_KEY && AI_PROVIDER !== 'groq') {
    replyText = await callGeminiFlash(systemPrompt, history, userMessage);
  } else if (GROQ_API_KEY && AI_PROVIDER === 'groq') {
    replyText = await callGroqLlama(systemPrompt, history, userMessage);
  } else {
    // Intelligent local fallback if no API key is configured yet
    replyText = generateLocalFallback(workspaceContext, userMessage, currentUser);
  }

  // 5. Persist turns in SQLite
  const insertStmt = db.prepare(`
    INSERT INTO ai_messages (thread_id, sender_role, content, created_at)
    VALUES (?, ?, ?, datetime('now'))
  `);
  insertStmt.run(activeThreadId, 'user', userMessage.trim());
  insertStmt.run(activeThreadId, 'model', replyText);

  db.prepare(`UPDATE ai_threads SET updated_at = datetime('now') WHERE id = ?`).run(activeThreadId);

  return {
    threadId: activeThreadId,
    reply: replyText
  };
}

/**
 * Native REST call to Google Gemini 1.5 Flash via standard fetch()
 */
async function callGeminiFlash(systemPrompt, history, userMessage) {
  const contents = [];

  // Map history to Gemini format
  for (const h of history) {
    contents.push({
      role: h.sender_role === 'user' ? 'user' : 'model',
      parts: [{ text: h.content }]
    });
  }

  // Current user prompt
  contents.push({
    role: 'user',
    parts: [{ text: userMessage }]
  });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents,
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 600
      }
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error('Gemini API Error:', errorBody);
    throw new Error('Gemini API communication failed');
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response returned from Oracle.';
}

/**
 * Native REST call to Groq (Llama 3.3 70B) via OpenAI-compatible endpoint
 */
async function callGroqLlama(systemPrompt, history, userMessage) {
  const messages = [
    { role: 'system', content: systemPrompt }
  ];

  for (const h of history) {
    messages.push({
      role: h.sender_role === 'user' ? 'user' : 'assistant',
      content: h.content
    });
  }

  messages.push({ role: 'user', content: userMessage });
  const modelsToTry = [
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b',
    'qwen/qwen3.8-27b',
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant'
  ];

  let lastError = null;
  for (const model of modelsToTry) {
    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.2,
          max_tokens: 600
        })
      });

      if (response.ok) {
        const data = await response.json();
        return data.choices?.[0]?.message?.content || 'No response returned from Oracle.';
      } else {
        const errorBody = await response.text();
        lastError = errorBody;
        console.warn(`Groq model ${model} failed, trying next...:`, errorBody);
      }
    } catch (err) {
      lastError = err.message;
      console.warn(`Groq request for ${model} threw error:`, err);
    }
  }

  throw new Error(`All Groq models failed. Last error: ${lastError}`);
}

/**
 * Intelligent local fallback when no external LLM API key is configured.
 * Answers common workspace questions directly from SQLite without breaking!
 */
function generateLocalFallback(workspaceContext, userMessage, currentUser) {
  const text = userMessage.toLowerCase();

  if (/task|todo|progress|deliverable/.test(text)) {
    const tasks = db.prepare('SELECT title, status, deadline FROM tasks').all();
    if (tasks.length === 0) return 'There are currently no tasks allocated in the workspace.';
    const list = tasks.map(t => `• **[${t.status}]** ${t.title} *(Due: ${t.deadline || 'TBD'})*`).join('\n');
    return `### Current Workspace Tasks\n\n${list}\n\n*(Tip: Add \`GEMINI_API_KEY\` in your \`.env\` file for full conversational AI reasoning!)*`;
  }

  if (/meet|call|sync|google|bridge/.test(text)) {
    const events = db.prepare('SELECT title, event_date, time_label, target_audience FROM calendar_events').all();
    if (events.length === 0) return 'There are no active or scheduled meetings at this time.';
    const list = events.map(e => `• **${e.title}** on ${e.event_date} at ${e.time_label} (${e.target_audience})`).join('\n');
    return `### Scheduled Syncs & Meeting Bridges\n\n${list}\n\n*To join, click the join button in your dashboard to route through the masked gateway.*`;
  }

  if (/who are you|oracle|help/.test(text)) {
    return `👋 **Hello ${currentUser.name}!** I am **Frontier Oracle**, your internal AI engineering assistant.

I can help you keep track of:
- **Sprint Deliverables & Tasks** (Assignees, status, deadlines)
- **Google Meet Bridges & Calendar Syncs**
- **Peer Tasklets & Team Directory**

*(To enable full natural language generation, set \`GEMINI_API_KEY\` in your \`.env\` file)*`;
  }

  return `I reviewed the Frontier AI workspace state for you:

${workspaceContext}

*(Set \`GEMINI_API_KEY\` in your \`.env\` to unlock full conversational generation and reasoning!)*`;
}
