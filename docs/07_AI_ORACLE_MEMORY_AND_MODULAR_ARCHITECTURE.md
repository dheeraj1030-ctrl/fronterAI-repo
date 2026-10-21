# Frontier AI — Architectural Decision Record (ADR-07)

# AI Oracle, 3-Tier Memory Engine, Token Optimization, and Modular Architecture

| Metadata | Details |
|---|---|
| **Status** | Approved & Implemented Architectural Specification |
| **Author** | Frontier AI Engineering Team |
| **Last Updated** | October 2026 |
| **Scope** | Modular Backend Architecture, AI Workspace Oracle, SQLite 3-Tier Memory, Dynamic Token Optimization |
| **Primary Constraints** | Permanent ₹0 operational cost, zero npm dependencies (`node_modules` = 0 bytes), strict role-based data isolation, cryptographic blind ballot protection |

---

## 1. Executive Summary & Architectural Decisions

This document records the official architectural decisions and implemented structure for the Frontier AI collaborative platform:

1. **Commitment to SQLite (PostgreSQL Discarded):** 
   - PostgreSQL was evaluated and explicitly discarded in favor of embedded **SQLite (`node:sqlite`) with Write-Ahead Logging (WAL)**.
   - **Rationale:** SQLite requires zero server daemons, incurs 0 network latency hops, boots in under 15ms, costs ₹0, introduces 0 npm dependencies, and maps directly 1:1 to our production edge target: **Cloudflare D1**.
2. **Complete Modular Backend Refactoring:** 
   - Decoupled the monolithic 1,388-line `server.js` into clean, domain-specific modules (`config.js`, `middleware/`, `services/`, `routes/`, and a lean `server.js` entry point < 30 lines).
3. **The Frontier Oracle AI Assistant:** 
   - An in-platform intelligence assistant powered by Google Gemini 1.5 Flash (with Groq Llama 3 fallback and offline SQLite reasoning).
4. **The 3-Tier Memory Engine in SQLite:** 
   - Combining dynamic live workspace context, short-term conversational threads in `ai_threads` / `ai_messages`, and long-term user profile memory in `member_memories`.
5. **Anti-Context-Stuffing Token Optimization:** 
   - Eliminating token bloat through compact tabular markdown projections, intent-based dynamic table queries, and sliding-window memory management.

---

## 2. Modular Codebase Architecture

The backend has been modularized without adding any external npm packages:

```
fronterAI-repo/
├── server.js                   # Minimal server entry point (< 30 lines)
├── config.js                   # Zero-dependency env loader, port, keys, and constants
├── db.js                       # SQLite instance, WAL mode, pragmas, schema, audit logger
├── middleware/
│   ├── httpHelpers.js          # parseCookies, parseBody, sendJson with double-write guards
│   └── session.js              # SQLite persistent session tokens & expiration sweeper
├── services/
│   ├── ballotCrypto.js         # Two-phase blind HMAC-SHA256 ballot cryptographic engine
│   └── aiService.js            # Frontier Oracle context builder & multi-model LLM client
├── routes/
│   ├── index.js                # Central router dispatcher with res.writableEnded guards
│   ├── authRoutes.js           # Real GitHub OAuth 2.0, allowlist gating, session logins
│   ├── memberRoutes.js         # Roster, host onboarding (with GitHub API fetch), removal
│   ├── dashboardRoutes.js      # Personal dashboard metrics, audience-filtered calendar
│   ├── meetingRoutes.js        # 6-slot LRU rotation, masked companion gateway redirect
│   ├── calendarRoutes.js       # Calendar events, live meeting pings, and end signals
│   ├── taskRoutes.js           # Sprint deliverables, OCC concurrency, PR submissions
│   ├── votingRoutes.js         # Blind token claim, anonymous ballot casting, session closure
│   ├── taskletRoutes.js        # Peer-to-peer micro-tasks and status state machine
│   ├── governanceRoutes.js     # Two-Person Rule access tickets & approval workflow
│   ├── auditRoutes.js          # Tamper-evident security audit log viewer
│   ├── disasterRecoveryRoutes.js # Authorator Git JSON export (14 database tables)
│   ├── aiRoutes.js             # Frontier Oracle chat, thread history, thread deletion
│   └── staticRoutes.js         # Zero-dependency static file streamer from public/
└── public/                     # Vanilla ES Module client with dark Google Workspace UI
```

---

## 3. The 3-Tier Memory Engine in SQLite

Memory is organized into three distinct tiers inside SQLite:

```
+-----------------------------------------------------------------------------------------+
|                                3-TIER MEMORY ARCHITECTURE                               |
+-----------------------------------------------------------------------------------------+
|  TIER 1: WORKING MEMORY (Dynamic Snapshot)                                              |
|  - Injects current tasks, upcoming meetings, active tasklets, and member directory.     |
|  - Role-sanitized: Excludes unblinded ballots, used tokens, and private numeric IDs.    |
+-----------------------------------------------------------------------------------------+
|  TIER 2: SHORT-TERM CONVERSATIONAL MEMORY (Sliding Window in SQLite)                    |
|  - Stored in `ai_threads` and `ai_messages` tables.                                     |
|  - Retains the last 6 dialogue turns to support natural conversational follow-ups.      |
+-----------------------------------------------------------------------------------------+
|  TIER 3: LONG-TERM PROFILE & GOAL MEMORY (JSON Document in SQLite)                      |
|  - Stored in `member_memories` table as a structured JSON object per user.              |
|  - Tracks skills, focus track, blockers, preferences, and historical deliverables.      |
+-----------------------------------------------------------------------------------------+
```

### Memory Schema:

```sql
-- Conversational AI Threads
CREATE TABLE IF NOT EXISTS ai_threads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (member_id) REFERENCES members (id) ON DELETE CASCADE
);

-- AI Conversation Messages
CREATE TABLE IF NOT EXISTS ai_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id INTEGER NOT NULL,
  sender_role TEXT NOT NULL, -- 'user' or 'model'
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (thread_id) REFERENCES ai_threads (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ai_messages_thread ON ai_messages (thread_id);

-- Long-Term Member Profile & Goal Memory
CREATE TABLE IF NOT EXISTS member_memories (
  member_id INTEGER PRIMARY KEY,
  memory_data TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  FOREIGN KEY (member_id) REFERENCES members (id) ON DELETE CASCADE
);
```

---

## 4. Token Optimization & Anti-Context Stuffing

To eliminate token waste and avoid hitting free-tier limits:

1. **Compact Markdown Projections (90% Reduction):** Converts database records into compact markdown bullet lists instead of bulky JSON objects.
2. **Intent-Based Keyword Routing:** Only queries and injects database tables relevant to the user's question (e.g. queries `tasks` only when tasks/progress are mentioned; queries `calendar_events` only when meetings are mentioned).
3. **Sliding-Window Memory:** Caps history to 6 turns ($< 300$ tokens).
4. **Intelligent Offline Fallback:** If no `GEMINI_API_KEY` is configured in `.env`, the assistant inspects SQLite and answers common task and meeting questions directly from the database without crashing or erroring.

---

## 5. Security & Isolation Guarantees

1. **Blind Ballot Protection:** The context compiler explicitly omits `ballots`, `used_tokens`, and `voting_eligibility`. The AI assistant has zero technical mechanism to infer or expose anonymous peer review votes.
2. **Numeric GitHub IDs Masked:** The AI context compiler only receives public GitHub usernames (`@potatobun321`), never immutable numeric GitHub IDs (`github_numeric_id`).
3. **Role-Gated Ingestion:** Non-host members querying the bot cannot view pending access tickets, raw audit logs, or administrative recovery endpoints.
4. **Session Gating:** Unauthenticated queries to `/api/ai/*` return `HTTP 401 Unauthorized`.
