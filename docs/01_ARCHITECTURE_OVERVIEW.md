# Frontier AI — System Architecture & Design Philosophy

## 1. High-Level System Architecture

Frontier AI is an internal engineering workspace and team governance platform engineered for an 8-member college project team. It is designed to run indefinitely at **zero operational cost (₹0 budget)** while maintaining strict security boundaries, robust role-based access control, cryptographic privacy guarantees, and a distraction-free student user experience.

```
+-----------------------------------------------------------------------------------------+
|                                CLIENT RUNTIME (BROWSER)                                 |
|                                                                                         |
|  +-----------------------------------------------------------------------------------+  |
|  | Modern Vanilla Frontend (HTML5 / Vanilla CSS Design System / ES Modules)          |  |
|  | - Reactive State Container: (currentUser, tasks, tasklets, voting, callEvents)   |  |
|  | - Role-Adaptive Sidebar: (Members -> Peers & Tasklets | Lead -> Settings & Logs)   |  |
|  | - Sized Kanban Boards (~2 cards tall, smooth vertical scrolling, OCC conflict UI)|  |
|  | - Google Meet Gateway (Masked `/api/meetings/join/:id`, attendance audit log, popout)|  |
|  | - Multi-Template Peer Review: (1: Peer Performance, 2: Project Quality Review)    |  |
|  | - Client Storage Caching: (HMAC Blind Tokens in sessionStorage)                   |  |
|  +-----------------------------------------------------------------------------------+  |
+--------------------------------------------+--------------------------------------------+
                                             |
                            Fetch REST API (JSON / HttpOnly Cookie)
                                             |
                                             v
+-----------------------------------------------------------------------------------------+
|                          BACKEND ENGINE (ZERO NPM DEPENDENCIES)                         |
|                                                                                         |
|  +-----------------------------------------------------------------------------------+  |
|  | Node.js Standard Library HTTP Server (`node:http`, `node:crypto`, `node:sqlite`)  |  |
|  |                                                                                   |  |
|  | - Security & Auth Gateway: Hard allowlist checking immutable GitHub numeric IDs   |  |
|  | - Session Manager: SQLite-backed persistent sessions with 7-day TTL              |  |
|  | - Task & Tasklet Engine: Sprint assignments (OCC) + Peer-to-peer micro-tasks     |  |
|  | - Masked Meeting Gateway: 6-slot rotation, attendance tracking, secure 302 redirect|
|  | - Cryptographic Engine: HMAC-SHA256 blind ballot issuer & verification ledger     |  |
|  | - Two-Person Governance: "Four-Eyes" rule approval workflow                       |  |
|  | - Audit Logger: Append-only ledger recording all security and user events         |  |
|  +-----------------------------------------------------------------------------------+  |
+--------------------------------------------+--------------------------------------------+
                                             |
                                Prepared SQL Queries
                                             |
                                             v
+-----------------------------------------------------------------------------------------+
|                               DATA PERSISTENCE LAYER                                    |
|                                                                                         |
|  +-----------------------------------------------------------------------------------+  |
|  | Localhost: SQLite via `node:sqlite` (`frontier.db`)                               |  |
|  | Target Production: Cloudflare D1 (Serverless Distributed SQLite Engine)           |  |
|  | Tables: members, sessions, tasks, tasklets, meeting_slots, calendar_events,        |  |
|  |         voting_sessions, voting_options, voting_eligibility, used_tokens, ballots, |  |
|  |         access_tickets, audit_logs                                                |  |
|  +-----------------------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------------------+
```

---

## 2. Zero-Cost (₹0) Budget Philosophy

Most contemporary college and startup prototypes fall into the "freemium trap":
1. **Firebase / Supabase / AWS RDS**: Provide generous initial tiers but enforce hard billing requirements, credit card mandates, or severe limits that lead to surprise charges or project shutdowns after 12 months.
2. **Third-party SaaS (Jira, Linear, Slack)**: Introduce per-seat licensing costs that are unviable for unfunded student initiatives.

### The Frontier AI Hosting Target
| Component | Localhost Prototype | Production Edge Platform | Cost |
|---|---|---|---|
| **Frontend Static Assets** | Node.js static file server | **Cloudflare Pages** | **₹0** (Unlimited bandwidth) |
| **Serverless API Execution** | Node.js standard library | **Cloudflare Workers** | **₹0** (100,000 requests/day free) |
| **Relational Database** | `node:sqlite` | **Cloudflare D1** | **₹0** (5 million read rows/day free) |
| **Code & Backup Storage** | Local `backups/` directory | **GitHub Repository** | **₹0** (Private Git repo) |
| **Total Monthly Spend** | **₹0.00** | **₹0.00** | **Permanent ₹0** |

By strictly utilizing **standard SQL** compatible with SQLite and Cloudflare D1, all queries written for the local prototype execute identically in production without database abstraction layers (ORMs) or proprietary query languages.

---

## 3. The "Zero External Dependencies" Mandate

The entire backend is built without a single third-party package (`node_modules` size: **0 bytes**).

### Why Zero npm Dependencies?
1. **Immunity to Supply-Chain Attacks**: Third-party packages frequently suffer from dependency confusion, hijacked maintainer accounts, and malicious updates. Zero dependencies means zero third-party attack vectors.
2. **Deterministic Startup**: The server boots in less than **15 milliseconds** because there is no package tree resolution.
3. **Auditability**: Evaluators, mentors, and teammates can read and audit 100% of the codebase in an afternoon.
4. **Permanent Stability**: No breaking updates, deprecation cycles, or peer dependency conflicts.

---

## 4. Layered Module Directory Structure

```
fronterAI-repo/
├── server.js                        # Zero-dependency Node.js HTTP server & REST API routes
├── db.js                            # SQLite schema, persistent sessions, seed data, and audit logger
├── auth.js                          # Cryptographic HMAC-SHA256 blind ballot token engine
├── test_prototype.js                # 17-point automated verification & security suite
├── package.json                     # Project manifest (ES Modules enabled, zero dependencies)
├── frontier.db                      # SQLite database file (WAL mode enabled)
├── .env.example                     # Environment configuration template
├── backups/                         # Sanitized JSON disaster recovery snapshots
├── docs/                            # Multi-file technical documentation suite
│   ├── 01_ARCHITECTURE_OVERVIEW.md  # High-level architecture and design philosophy
│   ├── 02_AUTHENTICATION_SECURITY.md# Hard allowlist, RBAC, sessions, and two-person rule
│   ├── 03_TASKS_AND_TASKLETS.md     # Kanban boards, OCC conflict handling, and peer tasklets
│   ├── 04_CRYPTOGRAPHIC_PEER_REVIEW.md # Two-phase blind voting, HMAC tokens, and templates
│   ├── 05_CALL_ROOM_AND_EMBEDDED_MEET.md # Google Meet rotation, masking, and companion gateway
│   └── 06_DEPLOYMENT_AND_MIGRATION_GUIDE.md # Production deployment to Cloudflare Pages/D1
└── public/
    ├── index.html                   # Semantic HTML layout (Google Workspace dark aesthetic)
    ├── styles.css                   # Responsive Vanilla CSS design system
    └── app.js                       # Vanilla JavaScript client (reactive state container)
```
