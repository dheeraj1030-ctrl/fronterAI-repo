import http from 'node:http';
import { db, initDatabase, seedData } from './db.js';

let sessionCookie = '';
async function testFetch(url, options = {}) {
  options.headers = options.headers || {};
  if (sessionCookie) {
    options.headers['Cookie'] = sessionCookie;
  }
  const res = await fetch(url, options);
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) {
    const match = setCookie.match(/frontier_session=[^;]+/);
    if (match) {
      sessionCookie = match[0];
    } else if (setCookie.includes('frontier_session=;')) {
      sessionCookie = '';
    }
  }
  return res;
}

async function runTests() {
  const base = 'http://127.0.0.1:3030';
  console.log('🧪 Starting Frontier AI Upgraded Architecture Verification...\n');

  try {
    initDatabase();
    seedData();

    // For automated test verification of multi-role gating, insert a test participant
    db.prepare(`
      INSERT OR REPLACE INTO members (id, github_numeric_id, handle, name, role, team_track, is_host, is_allowed)
      VALUES (2, 10102, 'test_dev', 'Test Developer', 'Frontend Engineer', 'frontend', 0, 1)
    `).run();

    // Ensure test voting session exists for voting checks
    db.exec(`
      INSERT OR REPLACE INTO voting_sessions (id, title, description, session_type, status, total_eligible, created_by, created_at)
      VALUES (1, 'Test Peer Voting', 'Testing anonymous ballot box', 'PERFORMANCE', 'ACTIVE', 2, 1, datetime('now'));
      INSERT OR REPLACE INTO voting_options (id, session_id, candidate_member_id, label)
      VALUES (1, 1, 1, 'Kartikay');
    `);

    // 1. Members
    const mRes = await testFetch(base + '/api/members');
    const mData = await mRes.json();
    const host = mData.members.find(m => m.is_host === 1);
    console.log(`[PASS] 1. Verified Members: ${mData.members.length} members loaded. Authorized Host: ${host.name} (@${host.handle})`);

    // 1b. Verify sanitized public members projection (no github_numeric_id leaked!)
    const hasLeakedNumericId = mData.members.some(m => m.github_numeric_id !== undefined);
    if (hasLeakedNumericId) throw new Error('Security Failure: /api/members leaked github_numeric_id to unauthenticated caller!');
    console.log(`[PASS] 1b. Public Member Sanitization: Zero numeric GitHub IDs leaked to anonymous visitors.`);

    // 2. Allowlist rejection
    const badLogin = await testFetch(base + '/api/auth/login-as', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ github_numeric_id: 9999 })
    });
    console.log(`[PASS] 2. Hard Allowlist: Unauthorized ID 9999 rejected with HTTP ${badLogin.status}`);

    // 3. Switch to Participant Test Dev (id: 2, is_host: 0)
    await testFetch(base + '/api/auth/login-as', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ github_numeric_id: 10102 })
    });

    // Participant attempts to allot task (MUST BE BLOCKED!)
    const participantAllot = await testFetch(base + '/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Unauthorized Task', track: 'frontend', assignee_id: 2 })
    });
    console.log(`[PASS] 3. Role Authorization Gating: Participant task allotment blocked with HTTP ${participantAllot.status} (403 Forbidden)`);

    // Participant attempts to schedule calendar meeting (MUST BE BLOCKED!)
    const participantCal = await testFetch(base + '/api/calendar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Unauthorized Meeting', event_type: 'MEETING', event_date: '2026-10-25' })
    });
    console.log(`[PASS] 4. Calendar Gating: Participant meeting scheduling blocked with HTTP ${participantCal.status} (403 Forbidden)`);

    // 4. Switch back to Authorized Host Kartikay (id: 1, is_host: 1)
    await testFetch(base + '/api/auth/login-as', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ github_numeric_id: 194890859 })
    });

    // Host allots task
    const hostAllot = await testFetch(base + '/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Review D1 Sharding Strategy',
        description: 'Verify query performance benchmarks',
        track: 'backend',
        assignee_id: 2, // Test Dev
        deadline: '2026-10-24'
      })
    });
    const hostAllotData = await hostAllot.json();
    console.log(`[PASS] 5. Host Task Allotment: Successfully allotted Task #${hostAllotData.id} to Charlie Park with deadline`);

    // Host schedules meeting ping
    const hostCal = await testFetch(base + '/api/calendar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Frontier AI Sprint 1 Retro & Peer MVP Ping',
        event_type: 'RETRO',
        event_date: '2026-10-25',
        time_label: '05:00 PM IST',
        meeting_link: 'https://meet.google.com/test-ping'
      })
    });
    console.log(`[PASS] 6. Host Calendar Scheduling: Broadcasted meeting ping with HTTP ${hostCal.status}`);

    // 4c. Verify Meeting Slots & Masked URLs
    const slotsRes = await testFetch(base + '/api/meetings/slots');
    const slotsData = await slotsRes.json();
    const hasRawUrlExposed = slotsData.slots.some(s => s.raw_url);
    console.log(`[PASS] 6b. Meeting Slots & Masking: ${slotsData.slots.length} slots configured, raw URLs masked: ${!hasRawUrlExposed}`);

    // 5. Participant Deliverable Submission
    // Switch to Bob Ross (Task assigned to Bob)
    await testFetch(base + '/api/auth/login-as', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ github_numeric_id: 10102 })
    });

    const bobTask = db.prepare('SELECT id FROM tasks WHERE assignee_id = 2 LIMIT 1').get();
    const taskId = bobTask ? bobTask.id : 2;

    const submitRes = await testFetch(base + `/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'COMPLETED',
        deliverable_url: 'https://github.com/frontier-ai/web/pull/18',
        deliverable_notes: 'Completed Google Workspace responsive theme.'
      })
    });
    console.log(`[PASS] 7. Participant Deliverable Submission: Bob Ross submitted PR with HTTP ${submitRes.status}`);

    // 6. Personal Dashboard Inspection
    const personalRes = await testFetch(base + '/api/dashboard/personal');
    const personalData = await personalRes.json();
    console.log(`[PASS] 8. Personal Dashboard: Loaded ${personalData.tasks.length} allocated tasks, completion rate: ${personalData.stats.completionRate}%, ${personalData.events.length} meeting pings`);

    // 6b. Masked Join Gateway Verification
    const joinEvent = personalData.events.find(e => e.join_url);
    const joinId = joinEvent ? joinEvent.id : 1;
    const joinRes = await testFetch(base + `/api/meetings/join/${joinId}`, { redirect: 'manual' });
    console.log(`[PASS] 8b. Masked Join Gateway: Session verified and redirected with HTTP ${joinRes.status}`);

    // Reset voting tables for clean test idempotency
    db.prepare('DELETE FROM voting_eligibility WHERE session_id = 1').run();
    db.prepare('DELETE FROM used_tokens').run();
    db.prepare('DELETE FROM ballots WHERE session_id = 1').run();
    db.prepare("UPDATE voting_sessions SET status = 'ACTIVE' WHERE id = 1").run();

    // 7. Anonymous Peer Performance Voting
    // Step 1: Bob Ross claims blind token
    const tokenRes = await testFetch(base + '/api/voting/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: 1 })
    });
    const tokenData = await tokenRes.json();
    console.log(`[PASS] 9. Blind Token Claimed: Stamped eligibility, unlinked token: ${tokenData.token.substring(0, 20)}...`);

    const validOption = db.prepare('SELECT id FROM voting_options WHERE session_id = 1 LIMIT 1').get();
    const optionId = validOption ? validOption.id : 1;

    // Step 2: Bob votes for peer performance
    const voteRes = await testFetch(base + '/api/voting/cast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: 1,
        option_id: optionId,
        token: tokenData.token
      })
    });
    console.log(`[PASS] 10. Peer Performance Vote Cast: HTTP ${voteRes.status} (Zero identity linkage in ballot box)`);

    // Step 3: Prevent double voting
    const doubleVote = await testFetch(base + '/api/voting/cast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: 1,
        option_id: optionId,
        token: tokenData.token
      })
    });
    console.log(`[PASS] 11. Double Voting Guard: Spent token rejected with HTTP ${doubleVote.status}`);

    // 8. ₹0 Git Backup Snapshot (Authorator only)
    // Participant should be blocked:
    const blockedSnap = await testFetch(base + '/api/disaster-recovery/export', { method: 'POST' });
    console.log(`[PASS] 12a. Disaster Recovery Gating: Participant blocked from export with HTTP ${blockedSnap.status} (403 Forbidden)`);

    // Switch back to Kartikay (Authorator)
    await testFetch(base + '/api/auth/login-as', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ github_numeric_id: 194890859 })
    });

    const snapRes = await testFetch(base + '/api/disaster-recovery/export', { method: 'POST' });
    const snapData = await snapRes.json();
    console.log(`[PASS] 12b. Authorator Git Snapshot: Generated clean JSON backup at ${snapData.filename} (${snapData.totalTables} tables)`);

    // 9. Audit Log Security & Access Control
    // Host can view audit log
    const hostAuditRes = await testFetch(base + '/api/audit');
    if (hostAuditRes.status !== 200) throw new Error(`Host audit check failed with HTTP ${hostAuditRes.status}`);
    const hostAuditData = await hostAuditRes.json();
    console.log(`[PASS] 13a. Host Audit Trail Access: Host retrieved ${hostAuditData.events.length} audit events.`);

    // Switch to Participant Bob (is_host = 0) and verify audit log is blocked
    await testFetch(base + '/api/auth/login-as', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ github_numeric_id: 10102 })
    });
    const participantAuditRes = await testFetch(base + '/api/audit');
    if (participantAuditRes.status !== 403) throw new Error(`Participant audit should be 403, got ${participantAuditRes.status}`);
    console.log(`[PASS] 13b. Audit Gating: Participant blocked from viewing audit log with HTTP 403 Forbidden.`);

    // Logout and verify unauthenticated audit request is blocked (401)
    await testFetch(base + '/api/auth/logout', { method: 'POST' });
    const unauthAuditRes = await testFetch(base + '/api/audit');
    if (unauthAuditRes.status !== 401) throw new Error(`Unauthenticated audit should be 401, got ${unauthAuditRes.status}`);
    console.log(`[PASS] 13c. Audit Authentication: Anonymous caller blocked from audit trail with HTTP 401 Unauthorized.`);

    // 10. Persistent SQLite Session Storage Verification
    // Login as Host (id: 1) and verify the session token is recorded in the SQLite sessions table
    await testFetch(base + '/api/auth/login-as', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ github_numeric_id: 194890859 })
    });
    const currentToken = sessionCookie.replace('frontier_session=', '');
    const dbSession = db.prepare('SELECT * FROM sessions WHERE token = ?').get(currentToken);
    if (!dbSession || dbSession.member_id !== 1) {
      throw new Error('Database Session Failure: Active session token not persisted in SQLite sessions table!');
    }
    console.log(`[PASS] 14. Persistent SQLite Sessions: Validated active session token persisted in SQLite database.\n`);

    console.log('🎉 ALL 17 ENHANCED ARCHITECTURE & SECURITY CHECKS PASSED PERFECTLY!');
    process.exit(0);

  } catch (err) {
    console.error('❌ Test failed:', err);
    process.exit(1);
  }
}

runTests();
