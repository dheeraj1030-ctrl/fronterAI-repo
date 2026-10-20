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

---

## Visual and Workspace Design

- **Spacious Segmented Layout:** Top navigation bar with global search (Ctrl + K), left collapsible navigation rail with notification badges, and a segmented workspace canvas.
- **Google Workspace Dark Theme:** Dark surfaces (`#131314` canvas, `#1e1f20` cards, `#28292a` elevation) paired with Material design accents (Blue `#a8c7fa`, Green `#6dd58c`, Amber `#fdd663`, Red `#f2b8b5`).
- **Sized Kanban Columns:** Fixed-height containers (`TO DO`, `IN PROGRESS`, `COMPLETED`) fit ~2 cards comfortably with 3-line description clamping and smooth vertical scrolling for longer lists, eliminating jarring layout shifts.
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

# 2. Run the automated architecture & security verification suite (17 tests)
node test_prototype.js
```

---

## Architecture & Security Highlights

### 1. Authentication & Numeric Allowlist
- **Immutable Identifier Verification:** Validates incoming identities against the 8 allowlisted members using permanent **numeric GitHub IDs**, preventing impersonation via username changes.
- **Production Guarding:** Development simulation and bypass endpoints (`/api/auth/github/simulate`, `/api/auth/login-as`) return `HTTP 404 Not Found` in production environments (`NODE_ENV=production`).
- **Data Privacy:** Public endpoints sanitize member rosters, completely stripping sensitive numeric GitHub IDs for unauthenticated visitors.

### 2. Persistent SQLite Sessions
- **Crash & Restart Resilience:** Replaced volatile memory state with an indexed SQLite `sessions` table. Active sessions survive server restarts and reboots.
- **Cloud-Ready:** Designed to map 1:1 with Cloudflare D1 query syntax for future edge migration.

### 3. Role-Adaptive Navigation (Team Lead vs. Member)
- **Team Lead (Alice Vance):**
  - Sidebar item 4: **`Settings & Logs`** (Directory, Two-Person Permissions, Activity History, Database Snapshot).
  - Authority to allot formal sprint tasks, schedule calls, and manage review rounds.
- **Team Members:**
  - Sidebar item 4: **`Peers`** (Micro-tasklets and team directory).
  - Exchange informal peer micro-tasks with status tracking (`Pending`, `Accepted`, `Done`).
  - Access personal task board and cast anonymous peer evaluation ballots.

### 4. Meeting Coordination & Google Meet Gateway (Path A)
- **Zero-Cost Coordination:** Rotates 6 pre-configured Google Meet rooms based on least-recently-used scheduling.
- **Masked Gateway:** Raw URLs are never exposed in public HTML or API responses. Join buttons route through `/api/meetings/join/:id`, verifying member sessions and logging audit attendance before redirecting.
- **Dynamic State Indicator Hues:** Sidebar item dynamically adapts its entire active pill color (green for live sync, amber for scheduled call, blue for idle standby) and renders a clean 44px circle in collapsed mode.
- **Companion Architecture:** Launches a verified companion window directly into Google Meet, providing high-definition audio/video while keeping the main workspace focused on tasks, tasklets, and reviews.

### 5. Cryptographic Anonymous Peer Review (Blind HMAC Protocol)
- **Phase 1 (Token Claim):** Member claims an eligibility token detached from their identity. The server issues a cryptographically signed HMAC-SHA256 token containing an ephemeral nonce.
- **Phase 2 (Anonymous Cast):** Member submits their vote with the blind token. The ballot is recorded with zero linkage to the voter's identity.
- **Two Review Templates:**
  1. *Peer Performance Review*: Recognizing individual teammate contribution.
  2. *Project Quality Review*: 1-to-5 star evaluation of code quality and architecture.
- **Persistence Across Reload:** Uncast tokens persist in `sessionStorage`; closed session results persist permanently on the page with Host reopen capability.

### 6. Two-Person Rule Governance
- **Privilege Gating:** Sensitive administrative tasks require a formal Access Ticket specifying justification, scope, and duration.
- **Self-Approval Prevention:** Requesters are strictly prohibited from approving their own tickets.
- **Ephemeral Access:** Approved tickets grant temporary privileges that expire automatically after the requested duration.

### 7. Tamper-Evident Security Audit Log
- **Access Gated:** Strictly restricted to the Team Lead (`401 Unauthorized` for anonymous visitors; `403 Forbidden` for non-lead members).
- **Comprehensive Logging:** Records all authentication attempts, permission rejections, concurrency locks, ballot claims, and governance actions.

### 8. Disaster Recovery Snapshots
- Operates on SQLite as the active transactional engine with on-demand, sanitized JSON exports to `backups/` suitable for automated repository backup.

---

## Repository Structure

```
FrontierAI/
├── server.js                        # Zero-dependency Node.js HTTP server and REST API
├── db.js                            # SQLite database schema, persistent sessions, and audit logger
├── auth.js                          # Blind ballot token generator and HMAC signature validator
├── test_prototype.js                # Automated verification test suite (17 end-to-end checks)
├── package.json                     # Project manifest (ES Modules)
├── frontier.db                      # Local SQLite database file
├── .env.example                     # Environment template with security key instructions
├── backups/                         # Sanitized JSON snapshots exported for disaster recovery
├── frontier_ai_architecture_checkpoint.md  # Architectural specification reference
├── docs/                            # In-depth multi-file technical documentation suite
│   ├── README.md                    # Documentation index & quick reference
│   ├── 01_ARCHITECTURE_OVERVIEW.md  # Architecture & design philosophy
│   ├── 02_AUTHENTICATION_SECURITY.md# Hard allowlist, sessions, and RBAC
│   ├── 03_TASKS_AND_TASKLETS.md     # Dual tasks, OCC conflicts, and peer tasklets
│   ├── 04_CRYPTOGRAPHIC_PEER_REVIEW.md # Blind HMAC protocol & templates
│   ├── 05_CALL_ROOM_AND_EMBEDDED_MEET.md # Meeting slots & companion gateway
│   └── 06_DEPLOYMENT_AND_MIGRATION_GUIDE.md # Cloudflare Pages/Workers/D1 deployment
└── public/
    ├── index.html                   # Semantic HTML layout
    ├── styles.css                   # Workspace design system (dark theme, responsive layout)
    └── app.js                       # Vanilla ES Module client with reactive state management
```
