import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.join(__dirname, 'frontier.db');

export const db = new DatabaseSync(DB_PATH);

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS members (
      id INTEGER PRIMARY KEY,
      github_numeric_id INTEGER UNIQUE NOT NULL,
      handle TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      team_track TEXT NOT NULL,
      is_host INTEGER DEFAULT 0,
      is_allowed INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      track TEXT NOT NULL,
      assignee_id INTEGER,
      status TEXT NOT NULL DEFAULT 'TODO',
      deadline TEXT,
      deliverable_url TEXT,
      deliverable_notes TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (assignee_id) REFERENCES members (id)
    );

    CREATE TABLE IF NOT EXISTS meeting_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slot_code TEXT NOT NULL UNIQUE,
      slot_name TEXT NOT NULL,
      raw_url TEXT NOT NULL,
      last_used_at TEXT
    );

    CREATE TABLE IF NOT EXISTS calendar_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      event_type TEXT NOT NULL, -- 'DEADLINE', 'MEETING', 'RETRO'
      event_date TEXT NOT NULL,
      time_label TEXT NOT NULL,
      target_audience TEXT NOT NULL DEFAULT 'ALL', -- 'ALL', 'BACKEND', 'FRONTEND', or JSON array '[2,3]'
      assignee_id INTEGER, -- Legacy direct member assignment
      meeting_slot_id INTEGER,
      meeting_link TEXT,
      is_live INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER NOT NULL,
      FOREIGN KEY (assignee_id) REFERENCES members (id),
      FOREIGN KEY (meeting_slot_id) REFERENCES meeting_slots (id),
      FOREIGN KEY (created_by) REFERENCES members (id)
    );

    CREATE TABLE IF NOT EXISTS voting_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      session_type TEXT NOT NULL DEFAULT 'PERFORMANCE',
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      total_eligible INTEGER DEFAULT 8,
      created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      closed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS voting_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      candidate_member_id INTEGER,
      label TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES voting_sessions (id),
      FOREIGN KEY (candidate_member_id) REFERENCES members (id)
    );

    -- Records WHICH member collected a ballot token (Eligibility check)
    CREATE TABLE IF NOT EXISTS voting_eligibility (
      session_id INTEGER NOT NULL,
      member_id INTEGER NOT NULL,
      token_issued_at TEXT NOT NULL,
      PRIMARY KEY (session_id, member_id),
      FOREIGN KEY (session_id) REFERENCES voting_sessions (id),
      FOREIGN KEY (member_id) REFERENCES members (id)
    );

    -- Cryptographic hash of used ballot tokens to prevent double-spending
    CREATE TABLE IF NOT EXISTS used_tokens (
      token_hash TEXT PRIMARY KEY,
      used_at TEXT NOT NULL
    );

    -- Anonymized ballot box: ABSOLUTELY NO MEMBER_ID!
    CREATE TABLE IF NOT EXISTS ballots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      option_id INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES voting_sessions (id),
      FOREIGN KEY (option_id) REFERENCES voting_options (id)
    );

    -- 2-Man Rule Access-Request Tickets
    CREATE TABLE IF NOT EXISTS access_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requester_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      reason TEXT NOT NULL,
      scope TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL DEFAULT 30,
      status TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
      approver_id INTEGER,
      created_at TEXT NOT NULL,
      resolved_at TEXT,
      expires_at TEXT,
      FOREIGN KEY (requester_id) REFERENCES members (id),
      FOREIGN KEY (approver_id) REFERENCES members (id)
    );

    -- Tamper-evident Audit Events
    CREATE TABLE IF NOT EXISTS audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      actor_handle TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT NOT NULL,
      details TEXT,
      status TEXT NOT NULL
    );
  `);

  // Migrate calendar_events columns if missing
  const calCols = db.prepare('PRAGMA table_info(calendar_events)').all().map(c => c.name);
  if (!calCols.includes('target_audience')) {
    db.exec("ALTER TABLE calendar_events ADD COLUMN target_audience TEXT NOT NULL DEFAULT 'ALL'");
  }
  if (!calCols.includes('meeting_slot_id')) {
    db.exec('ALTER TABLE calendar_events ADD COLUMN meeting_slot_id INTEGER');
  }
  if (!calCols.includes('is_live')) {
    db.exec('ALTER TABLE calendar_events ADD COLUMN is_live INTEGER NOT NULL DEFAULT 0');
  }
  if (!calCols.includes('description')) {
    db.exec('ALTER TABLE calendar_events ADD COLUMN description TEXT');
  }

  // Ensure the 6 meeting slots exist
  const slotCount = db.prepare('SELECT COUNT(*) as count FROM meeting_slots').get();
  if (slotCount.count === 0) {
    seedMeetingSlots();
  }

  // Check if calendar_events exists or if seeding is needed
  const calCount = db.prepare('SELECT COUNT(*) as count FROM calendar_events').get();
  if (calCount.count === 0) {
    seedData();
  }
}

export function seedMeetingSlots() {
  db.exec('DELETE FROM meeting_slots;');
  const insertSlot = db.prepare('INSERT INTO meeting_slots (id, slot_code, slot_name, raw_url, last_used_at) VALUES (?, ?, ?, ?, ?)');
  insertSlot.run(1, 'SLOT-01', 'Meeting Bridge 1', 'https://meet.google.com/kuw-amav-swf', null);
  insertSlot.run(2, 'SLOT-02', 'Meeting Bridge 2', 'https://meet.google.com/mzs-atxy-yja', null);
  insertSlot.run(3, 'SLOT-03', 'Meeting Bridge 3', 'https://meet.google.com/sdj-njyx-bwm', null);
  insertSlot.run(4, 'SLOT-04', 'Meeting Bridge 4', 'https://meet.google.com/zky-swdi-phk', null);
  insertSlot.run(5, 'SLOT-05', 'Meeting Bridge 5', 'https://meet.google.com/nvr-adyb-wmb', null);
  insertSlot.run(6, 'SLOT-06', 'Meeting Bridge 6', 'https://meet.google.com/sae-wkpe-rth', null);
}

export function seedData() {
  // Clear old seed if re-running (delete child tables before parent tables)
  db.exec(`
    DELETE FROM ballots;
    DELETE FROM used_tokens;
    DELETE FROM voting_eligibility;
    DELETE FROM voting_options;
    DELETE FROM voting_sessions;
    DELETE FROM access_tickets;
    DELETE FROM calendar_events;
    DELETE FROM tasks;
    DELETE FROM members;
    DELETE FROM sqlite_sequence;
  `);

  seedMeetingSlots();

  const insertMember = db.prepare(`
    INSERT INTO members (id, github_numeric_id, handle, name, role, team_track, is_host, is_allowed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // ONLY 1 INDIVIDUAL IS THE HOST: Alice Vance (id: 1, is_host: 1)
  // All other 7 are Participants (is_host: 0)
  const members = [
    [1, 10101, 'alice_v', 'Alice Vance', 'Team Host & Lead', 'backend', 1, 1], // THE SOLE AUTHORIZED HOST
    [2, 10102, 'bob_r', 'Bob Ross', 'Frontend Engineer', 'frontend', 0, 1],
    [3, 10103, 'charlie_p', 'Charlie Park', 'Backend Engineer', 'backend', 0, 1],
    [4, 10104, 'dana_s', 'Dana Scully', 'Frontend Engineer', 'frontend', 0, 1],
    [5, 10105, 'ethan_h', 'Ethan Hunt', 'Security Engineer', 'backend', 0, 1],
    [6, 10106, 'fiona_g', 'Fiona Gallagher', 'UX & QA Engineer', 'frontend', 0, 1],
    [7, 10107, 'grace_h', 'Grace Hopper', 'Systems Reviewer', 'lead', 0, 1],
    [8, 10108, 'henry_f', 'Henry Ford', 'Platform Operations', 'lead', 0, 1]
  ];

  for (const m of members) {
    insertMember.run(...m);
  }

  // Seed tasks allocated by the Host
  const insertTask = db.prepare(`
    INSERT INTO tasks (title, description, track, assignee_id, status, deadline, deliverable_url, deliverable_notes, version, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tasks = [
    [
      'Design Blind Anonymous Ballot Token Protocol',
      'Implement HMAC token separation between voter identity and ballot payload to prevent small-team correlation leaks.',
      'backend',
      5, // Ethan
      'COMPLETED',
      '2026-10-18',
      'https://github.com/frontier-ai/specs/pull/12',
      'HMAC token blinding verified. Ready for performance peer review.',
      1,
      new Date(Date.now() - 86400000).toISOString()
    ],
    [
      'Build High-Contrast Google Workspace Style UI',
      'Deliver segmented views: Personal dashboard, global team view, and calendar ping widgets.',
      'frontend',
      2, // Bob
      'IN_PROGRESS',
      '2026-10-19',
      'https://github.com/frontier-ai/web/pull/18',
      'Layout segmented. Working on calendar countdown chips.',
      1,
      new Date().toISOString()
    ],
    [
      'Optimistic Concurrency Control in SQLite Engine',
      'Enforce version-check gating on task update APIs to gracefully reject conflicting simultaneous edits.',
      'backend',
      3, // Charlie
      'COMPLETED',
      '2026-10-17',
      'https://github.com/frontier-ai/api/pull/21',
      'OCC tests passing 100%.',
      1,
      new Date().toISOString()
    ],
    [
      'Client-Side Deliverables & PR Submissions',
      'Support attaching PR links, GitHub commits, and design documents directly to tasks.',
      'frontend',
      4, // Dana
      'TODO',
      '2026-10-21',
      '',
      '',
      1,
      new Date().toISOString()
    ],
    [
      'Two-Man Rule Ephemeral Capability Grant Flow',
      'Block self-approval on privileged access requests. Require distinct second peer approval before issuing ephemeral grants.',
      'backend',
      1, // Alice
      'IN_PROGRESS',
      '2026-10-20',
      '',
      '',
      1,
      new Date().toISOString()
    ],
    [
      'Automated ₹0 Disaster Recovery Snapshot Exporter',
      'Periodic export of sanitized database state to private repository backups without runtime locking.',
      'lead',
      8, // Henry
      'TODO',
      '2026-10-22',
      '',
      '',
      1,
      new Date().toISOString()
    ]
  ];

  for (const t of tasks) {
    insertTask.run(...t);
  }

  // Seed Calendar Events (Deadlines & Meeting Pings)
  const insertCal = db.prepare(`
    INSERT INTO calendar_events (title, description, event_type, event_date, time_label, target_audience, assignee_id, meeting_slot_id, meeting_link, is_live, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const events = [
    [
      'Sprint 1 Mid-Point Architecture Sync',
      'Technical architecture alignment across frontend and backend tracks.',
      'MEETING',
      '2026-10-16',
      '10:00 AM IST',
      'ALL',
      null, // Team-wide
      1,
      'https://meet.google.com/kuw-amav-swf',
      0,
      1
    ],
    [
      'Charlie Park: Concurrency PR Code Freeze',
      'Final code freeze deadline for optimistic concurrency control pull request.',
      'DEADLINE',
      '2026-10-17',
      '06:00 PM IST',
      'BACKEND',
      3, // Charlie
      null,
      null,
      0,
      1
    ],
    [
      'Ethan Hunt: Cryptographic Protocol Review',
      'Independent security review of blind HMAC token generation logic.',
      'DEADLINE',
      '2026-10-18',
      '11:59 PM IST',
      'BACKEND',
      5, // Ethan
      null,
      null,
      0,
      1
    ],
    [
      'Frontier AI All-Hands: Sprint 1 Peer Review & MVP Vote',
      'Sprint retrospective, review of deliverables, and anonymous peer impact voting.',
      'RETRO',
      '2026-10-20',
      '04:30 PM IST',
      'ALL',
      null, // Team-wide
      2,
      'https://meet.google.com/mzs-atxy-yja',
      0,
      1
    ]
  ];

  for (const ev of events) {
    insertCal.run(...ev);
  }

  // Seed Anonymous Peer Performance Voting Session hosted by Alice Vance
  db.exec(`
    INSERT INTO voting_sessions (id, title, description, session_type, status, total_eligible, created_by, created_at)
    VALUES (
      1,
      'Sprint 1 Peer Performance & Impact Evaluation',
      'Anonymous peer voting to recognize top engineering contribution, collaboration, and velocity in Sprint 1. Hosted by Team Lead. Your vote is 100% blind and unlinked.',
      'PERFORMANCE',
      'ACTIVE',
      8,
      1,
      '${new Date().toISOString()}'
    );

    -- Candidates are the team members!
    INSERT INTO voting_options (session_id, candidate_member_id, label) VALUES
      (1, 2, 'Bob Ross — Frontend Velocity, Google Workspace Theme & UI Responsiveness'),
      (1, 3, 'Charlie Park — Backend OCC Concurrency, Zero-Crash SQLite Handlers'),
      (1, 4, 'Dana Scully — Client State Separation, Component Architecture & Tests'),
      (1, 5, 'Ethan Hunt — Blind Token Protocol Design & Cryptographic Integrity'),
      (1, 6, 'Fiona Gallagher — UX Usability Auditing & Test Coverage'),
      (1, 7, 'Grace Hopper — Systems Architecture & Independent Code Reviews'),
      (1, 8, 'Henry Ford — Platform Resilience & Automated Git Disaster Recovery');
  `);

  // Seed access tickets
  db.exec(`
    INSERT INTO access_tickets (requester_id, title, reason, scope, duration_minutes, status, approver_id, created_at, resolved_at, expires_at)
    VALUES (
      5,
      'Add New Research Member to GitHub Allowlist',
      'Onboarding external advisor with restricted read permissions.',
      'security:allowlist_mutation',
      45,
      'PENDING_APPROVAL',
      NULL,
      '${new Date(Date.now() - 1200000).toISOString()}',
      NULL,
      NULL
    );
  `);

  // Log system initialization in audit
  db.prepare(`
    INSERT INTO audit_events (timestamp, actor_handle, action, target, details, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    new Date().toISOString(),
    'alice_v',
    'INIT_PLATFORM',
    'governance',
    'Frontier AI Platform initialized. Alice Vance designated as Team Host & Lead.',
    'SUCCESS'
  );
}

// Audit logger helper
export function logAudit(actorHandle, action, target, details, status = 'SUCCESS') {
  try {
    db.prepare(`
      INSERT INTO audit_events (timestamp, actor_handle, action, target, details, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(new Date().toISOString(), actorHandle, action, target, details, status);
  } catch (err) {
    console.error('Audit log failure:', err);
  }
}
