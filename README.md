# Frontier AI — Internal Engineering Platform

A full-stack, internal collaborative platform for Frontier AI designed around a Google Workspace aesthetic with spacious, segmented views and visual workflows. Built with **zero external dependencies** and architected for a permanent **₹0 hosting footprint** on GitHub Pages + Cloudflare Workers + Cloudflare D1.

---

## Technical Documentation Suite

Comprehensive technical and architectural documentation is available in the [`docs/`](docs/README.md) directory:

- [**01. Architecture Overview**](docs/01_ARCHITECTURE_OVERVIEW.md) — High-level system design, ₹0 budget constraints, and the zero npm dependencies mandate.
- [**02. Authentication & Security**](docs/02_AUTHENTICATION_SECURITY.md) — Immutable numeric GitHub ID allowlist, persistent SQLite sessions, and Two-Person Rule governance.
- [**03. Tasks & Peer Tasklets**](docs/03_TASKS_AND_TASKLETS.md) — Dual task paradigm: formal sprint deliverables with OCC vs. informal peer micro-tasks ("tasklets").
- [**04. Cryptographic Peer Review**](docs/04_CRYPTOGRAPHIC_PEER_REVIEW.md) — Two-Phase Blind HMAC-SHA256 protocol, 2 review templates, and client token caching.
- [**05. Call Room & Google Meet Gateway**](docs/05_CALL_ROOM_AND_EMBEDDED_MEET.md) — 6-slot Google Meet rotation, masked access gateway, dynamic state hues, and companion window launch.
- [**06. Deployment & Cloudflare Guide**](docs/06_DEPLOYMENT_AND_MIGRATION_GUIDE.md) — Step-by-step roadmap to migrate from localhost Node.js + SQLite to Cloudflare Pages/Workers/D1.
- [**07. AI Oracle, Memory & Modular Architecture**](docs/07_AI_ORACLE_MEMORY_AND_MODULAR_ARCHITECTURE.md) — Architectural blueprint for the AI Oracle assistant, 3-tier SQLite memory engine, token optimization, and decoupled backend structure.

---

## Visual and Workspace Design

- **Spacious Segmented Layout:** Top navigation bar with global search (Ctrl + K), left collapsible navigation rail with notification badges, and a segmented workspace canvas.
- **Google Workspace Dark Theme:** Dark surfaces (`#131314` canvas, `#1e1f20` cards, `#28292a` elevation) paired with Material design accents (Blue `#a8c7fa`, Green `#6dd58c`, Amber `#fdd663`, Red `#f2b8b5`).
- **Sized Kanban Columns:** Fixed-height containers (`TO DO`, `IN PROGRESS`, `COMPLETED`) fit ~2 cards comfortably with 3-line description clamping and smooth vertical scrolling for longer lists, eliminating jarring layout shifts.
- **Frontier Oracle AI Workspace:** Integrated multi-turn AI assistant with persistent conversation threads, interactive suggestion chips, and real-time project memory.
- **Google Meet Companion Gateway:** Masked redirect gateway (`/api/meetings/join/:id`) that logs attendance and launches a verified companion tab for real multi-user HD video at zero budget.
- **Clean Sans-Serif Typography:** Clean typography (Google Sans, Inter, system-ui) with tabular numbers and monospace for cryptographic hashes and versions.

---

## Quickstart & Verification

The server runs on standard Node.js (v22+) with **zero npm dependencies**.

```bash
# 1. Run local development server (accessible at http://localhost:3030)
npm start

# Or with automatic reload during development:
npm run dev

# 2. Run the automated architecture, security & AI memory verification suite (20 tests)
node test_prototype.js
```

---

## Architecture & Security Highlights

### 1. Authentication & Numeric Allowlist
- **Immutable Identifier Verification:** Validates incoming identities against allowlisted members using permanent **numeric GitHub IDs**, preventing impersonation via username changes.
- **Production Guarding:** Development simulation and bypass endpoints (`/api/auth/github/simulate`, `/api/auth/login-as`) return `HTTP 404 Not Found` in production environments (`NODE_ENV=production`).
- **Data Privacy:** Public endpoints sanitize member rosters, completely stripping sensitive numeric GitHub IDs for unauthenticated visitors.

### 2. Persistent SQLite Sessions & WAL Concurrency
- **Crash & Restart Resilience:** Replaced volatile memory state with an indexed SQLite `sessions` table. Active sessions survive server restarts and reboots.
- **High Concurrency with WAL Mode:** Configured with `PRAGMA journal_mode = WAL;` and `PRAGMA busy_timeout = 5000;`, enabling concurrent reads without write locks.
- **Cloud-Ready:** Designed to map 1:1 with Cloudflare D1 query syntax for future edge migration.

### 3. Frontier Oracle AI Assistant & 3-Tier SQLite Memory
- **Dual-Model Support:** Connects natively to **Google Gemini 1.5 Flash** (1M token context, native document/screenshot parsing) with fallback to **Groq (Llama 3.3 70B)** via standard `fetch()`—zero external npm SDKs required.
- **3-Tier SQLite Memory Engine:**
  - *Tier 1 (Working Memory):* Real-time workspace context compiled live from active sprint deliverables, calendar syncs, and team directories.
  - *Tier 2 (Conversational Memory):* Sliding-window multi-turn conversation history persisted across reloads in `ai_threads` and `ai_messages`.
  - *Tier 3 (Long-Term Profile Memory):* Structured user profiles, skills, and goal track records stored in `member_memories`.
- **Anti-Context-Stuffing Token Optimization:** Uses compact tabular markdown projections and intent-based keyword filtering to reduce token consumption by **80–90%**, easily remaining within free-tier quotas.
- **Intelligent Offline Fallback:** If no external API key is configured, the assistant inspects SQLite and answers common project questions directly from the database without crashing.

### 4. Role-Adaptive Navigation (Team Lead vs. Member)
- **Team Lead:**
  - Sidebar item: **`Settings & Logs`** (Directory, Two-Person Permissions, Activity History, Database Snapshot).
  - Authority to allot formal sprint tasks, schedule calls, and manage review rounds.
- **Team Members:**
  - Sidebar item: **`Peers`** (Micro-tasklets and team directory).
  - Exchange informal peer micro-tasks with status tracking (`Pending`, `Accepted`, `Done`).
  - Access personal task board and cast anonymous peer evaluation ballots.
- **All Members:**
  - Sidebar item: **`Oracle AI`** (Real-time project intelligence and workspace assistant).

### 5. Meeting Coordination & Google Meet Gateway (Path A)
- **Zero-Cost Coordination:** Rotates 6 pre-configured Google Meet rooms based on least-recently-used scheduling.
- **Masked Gateway:** Raw URLs are never exposed in public HTML or API responses. Join buttons route through `/api/meetings/join/:id`, verifying member sessions and logging audit attendance before redirecting.
- **Dynamic State Indicator Hues:** Sidebar item dynamically adapts its active pill color (green for live sync, amber for scheduled call, blue for idle standby) and renders a clean 44px circle in collapsed mode.
- **Companion Architecture:** Launches a verified companion window directly into Google Meet, providing high-definition audio/video while keeping the main workspace focused on tasks, tasklets, and reviews.

### 6. Cryptographic Anonymous Peer Review (Blind HMAC Protocol)
- **Phase 1 (Token Claim):** Member claims an eligibility token detached from their identity. The server issues a cryptographically signed HMAC-SHA256 token containing an ephemeral nonce.
- **Phase 2 (Anonymous Cast):** Member submits their vote with the blind token. The ballot is recorded with zero linkage to the voter's identity.
- **Two Review Templates:**
  1. *Peer Performance Review*: Recognizing individual teammate contribution.
  2. *Project Quality Review*: 1-to-5 star evaluation of code quality and architecture.
- **Persistence Across Reload:** Uncast tokens persist in `sessionStorage`; closed session results persist permanently on the page with Host reopen capability.

### 7. Two-Person Rule Governance
- **Privilege Gating:** Sensitive administrative tasks require a formal Access Ticket specifying justification, scope, and duration.
- **Self-Approval Prevention:** Requesters are strictly prohibited from approving their own tickets.
- **Ephemeral Access:** Approved tickets grant temporary privileges that expire automatically after the requested duration.

### 8. Tamper-Evident Security Audit Log
- **Access Gated:** Strictly restricted to the Team Lead (`401 Unauthorized` for anonymous visitors; `403 Forbidden` for non-lead members).
- **Comprehensive Logging:** Records all authentication attempts, permission rejections, concurrency locks, ballot claims, and governance actions.

### 9. Disaster Recovery Snapshots
- Operates on SQLite as the active transactional engine with on-demand, sanitized JSON exports to `backups/` across all 14 database tables, suitable for automated repository backup.

---

## Modular Repository Structure

```
FrontierAI/
├── server.js                        # Clean HTTP server entry point (< 30 lines)
├── config.js                        # Zero-dependency env loader, port, keys & constants
├── db.js                            # SQLite DatabaseSync, WAL mode, pragmas & schema
├── test_prototype.js                # Automated verification suite (20 end-to-end checks)
├── package.json                     # Project manifest (ES Modules, zero dependencies)
├── frontier.db                      # Local SQLite database file (WAL enabled)
├── .env.example                     # Environment template with security key instructions
├── backups/                         # Sanitized JSON snapshots exported for disaster recovery
├── frontier_ai_architecture_checkpoint.md  # Architectural specification reference
│
├── middleware/                      # Reusable server middleware
│   ├── httpHelpers.js               # Cookie parsing, JSON body parsing & response guards
│   └── session.js                   # SQLite persistent sessions & expiration sweeper
│
├── services/                        # Business logic & external service integrations
│   ├── ballotCrypto.js              # Blind HMAC-SHA256 ballot cryptographic engine
│   └── aiService.js                 # Frontier Oracle context builder & multi-model LLM client
│
├── routes/                          # Modular domain route handlers
│   ├── index.js                     # Master route dispatcher with response guards
│   ├── authRoutes.js                # Real GitHub OAuth 2.0, allowlist gating, session logins
│   ├── memberRoutes.js              # Roster, host onboarding (with GitHub API), member removal
│   ├── dashboardRoutes.js           # Personal dashboard metrics, audience-filtered calendar
│   ├── meetingRoutes.js             # 6-slot LRU rotation, masked companion gateway redirect
│   ├── calendarRoutes.js            # Calendar events, live meeting pings & end signals
│   ├── taskRoutes.js                # Sprint deliverables, OCC concurrency, PR submissions
│   ├── votingRoutes.js              # Blind token claim, anonymous ballot casting, session closure
│   ├── taskletRoutes.js             # Peer-to-peer micro-tasks and status state machine
│   ├── governanceRoutes.js          # Two-Person Rule access tickets & approval workflow
│   ├── auditRoutes.js               # Tamper-evident security audit log viewer
│   ├── disasterRecoveryRoutes.js    # Authorator Git JSON export (14 database tables)
│   ├── aiRoutes.js                  # Frontier Oracle chat, thread history & memory
│   └── staticRoutes.js              # Zero-dependency static file streamer from public/
│
├── docs/                            # In-depth multi-file technical documentation suite
│   ├── README.md                    # Documentation index & quick reference
│   ├── 01_ARCHITECTURE_OVERVIEW.md  # Architecture & design philosophy
│   ├── 02_AUTHENTICATION_SECURITY.md# Hard allowlist, sessions, and RBAC
│   ├── 03_TASKS_AND_TASKLETS.md     # Dual tasks, OCC conflicts, and peer tasklets
│   ├── 04_CRYPTOGRAPHIC_PEER_REVIEW.md # Blind HMAC protocol & templates
│   ├── 05_CALL_ROOM_AND_EMBEDDED_MEET.md # Meeting slots & companion gateway
│   ├── 06_DEPLOYMENT_AND_MIGRATION_GUIDE.md # Cloudflare Pages/Workers/D1 deployment
│   └── 07_AI_ORACLE_MEMORY_AND_MODULAR_ARCHITECTURE.md # AI Oracle, Memory & Modular spec
│
└── public/
    ├── index.html                   # Semantic HTML layout with Oracle AI view
    ├── styles.css                   # Workspace design system (dark theme, responsive layout)
    └── app.js                       # Vanilla ES Module client with Oracle AI controller
```
