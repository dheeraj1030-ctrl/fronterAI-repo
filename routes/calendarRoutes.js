import { db, logAudit } from '../db.js';
import { getSessionUser } from '../middleware/session.js';
import { parseBody, sendJson } from '../middleware/httpHelpers.js';

export async function handleCalendarRoutes(req, res, pathname, method, urlObj) {
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

    if (event_type === 'MEETING' || event_type === 'RETRO') {
      if (meeting_slot_id && meeting_slot_id !== 'auto') {
        const slot = db.prepare('SELECT * FROM meeting_slots WHERE id = ?').get(parseInt(meeting_slot_id, 10));
        if (slot) {
          actualLink = slot.raw_url;
          assignedSlotId = slot.id;
          db.prepare('UPDATE meeting_slots SET last_used_at = ? WHERE id = ?').run(new Date().toISOString(), slot.id);
        }
      } else if (meeting_link && meeting_link.trim() !== '') {
        actualLink = meeting_link.trim();
      } else {
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

  return false;
}
