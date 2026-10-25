# Frontier AI — Developer Onboarding & Workflow Guide

Welcome to the **Frontier AI** engineering team! This guide explains our architecture, branching strategy, zero-cloud local development workflow, and testing practices.

---

## 1. Architectural Context: The Dual-Engine Model

Frontier AI is built with a dual-engine architecture designed for maximum development velocity and zero-cost cloud production:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        LOCAL DEVELOPMENT ENGINE                        │
│                                                                        │
│   • Branch: develop / feat/*                                           │
│   • Runtime: Node.js (v20+) native HTTP server (server.js)             │
│   • Database: Local SQLite file (frontier.db via better-sqlite3)       │
│   • Auth: One-click local persona pills / dev simulator                │
│   • Cloud Dependency: 0% (Fully offline-first, ₹0 cost)                │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │
                             Tested & Reviewed
                             Pull Request Flow
                                     │
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        PRODUCTION EDGE ENGINE                          │
│                                                                        │
│   • Branch: main (Auto-deployed to Cloudflare Pages)                   │
│   • Runtime: Cloudflare Pages Functions (functions/api/[[catchall]].js)│
│   • Database: Cloudflare D1 Serverless SQLite (env.DB)                 │
│   • Auth: Google OAuth 2.0 (Stateless HMAC-SHA256 signed states)       │
│   • Hosting: 100% Free-tier Serverless Edge (₹0 cost)                  │
└────────────────────────────────────────────────────────────────────────┘
```

### Why this matters to you:
As a developer, **you do not need Cloudflare credentials, Google Cloud Console access, or API keys** to build and test features. The entire platform boots instantly on your machine using local SQLite and zero external build tools.

---

## 2. Git Branching & Contribution Workflow

We follow a disciplined **Git Flow / GitHub Flow with Staging** model to ensure production stability:

```
[Your Machine]             [develop branch]                  [main branch]
(Local Feature)          (Team Staging & Base)             (Live Production)
      │                            │                               │
      ├─ 1. git checkout -b feat/x │                               │
      │                            │                               │
      ├─ 2. Code & test locally    │                               │
      │                            │                               │
      └─ 3. PR to develop ────────►│                               │
                                   │                               │
                                   ├─ 4. Code Review & Integration │
                                   │                               │
                                   └─ 5. Release PR ──────────────►│
                                                                   │
                                                      Auto-Deploys to Cloudflare
                                                      (fronterai-repo.pages.dev)
```

### Branch Definitions

| Branch | Purpose | Deployment Target | Direct Pushes Allowed? |
|---|---|---|:---:|
| **`main`** | **Production.** Represents the live deployed codebase. | Cloudflare Pages (`*.pages.dev`) | **NO (PR Only)** |
| **`develop`** | **Staging & Integration.** The default shared base branch for all developers. | Local integration / Cloudflare Previews | **PR Only** |
| **`feat/<name>`** | **Feature Work.** Short-lived branches created off `develop`. | Localhost (`http://localhost:3030`) | **YES (Your branch)** |
| **`fix/<name>`** | **Bugfixes.** Short-lived branches for issue patches. | Localhost (`http://localhost:3030`) | **YES (Your branch)** |

---

## 3. Step-by-Step Developer Lifecycle

### Step 1: Sync Your Local `develop` Branch
Always start your work from the latest code on `develop`:
```bash
git checkout develop
git pull origin develop
```

### Step 2: Create a Feature Branch
Use descriptive prefixes like `feat/`, `fix/`, `docs/`, or `refactor/`:
```bash
git checkout -b feat/task-filter-ui
```

### Step 3: Run the Local Dev Server
Start the local server with hot-reload or standard mode:
```bash
# Standard start:
npm start

# Or with automatic reload on file changes (Node 20+):
npm run dev
```
Open **`http://localhost:3030`** in your browser.

### Step 4: Sign in Locally (Zero Cloud Credentials Needed!)
When prompted on the login screen:
* **Option A (One-Click Demo Pills):** Click any of the persona pills (e.g., *Alice Vance (Host)* or *Bob Ross (Member)*) to instantly sign in with pre-seeded role permissions.
* **Option B (Dev Simulator):** Navigate to:
  ```
  http://localhost:3030/api/auth/google/simulate?email=your-name@gmail.com
  ```
  This immediately logs you into your local SQLite database without requiring Google OAuth keys.

### Step 5: Run Automated Tests
Before committing, verify that your changes did not break core security, OCC task locking, or AI context logic:
```bash
node test_prototype.js
```
*All 20 verification tests must pass (`[PASS]` output).*

### Step 6: Commit and Push Your Feature Branch
```bash
git add .
git commit -m "Add category filter dropdown to taskboard view"
git push -u origin feat/task-filter-ui
```

### Step 7: Open a Pull Request into `develop`
1. Go to the GitHub repository: [potatobun321/fronterAI-repo](https://github.com/potatobun321/fronterAI-repo).
2. Open a Pull Request with base **`develop`** $\leftarrow$ compare **`feat/task-filter-ui`**.
3. Detail what changed, attach screenshots for UI changes, and request a review from a peer or team lead.

---

## 4. Codebase Directory Map

```
fronterAI-repo/
├── public/                     # FRONTEND (Zero-build Vanilla JS/HTML/CSS)
│   ├── index.html              # Single Page Application structure & modals
│   ├── app.js                  # Frontend state machine, fetch interceptor, view router
│   └── styles.css              # Google Workspace dark theme tokens & component styles
│
├── functions/                  # PRODUCTION CLOUDFLARE BACKEND
│   └── api/
│       └── [[catchall]].js     # Edge router, D1 serverless SQL queries, Groq AI chat
│
├── routes/                     # LOCAL NODE.JS BACKEND (Mirrors functions/api/)
│   ├── authRoutes.js           # Google OAuth & session management
│   ├── memberRoutes.js         # Team directory & Host approval endpoints
│   ├── taskRoutes.js           # Sprint deliverables with OCC version locking
│   ├── taskletRoutes.js        # Peer-to-peer micro-task engine
│   ├── votingRoutes.js         # Blind HMAC anonymous ballot box
│   ├── meetingRoutes.js        # Google Meet rotation gateway
│   └── aiRoutes.js             # Frontier Oracle AI chat & memory endpoints
│
├── services/                   # CORE BUSINESS LOGIC
│   ├── aiService.js            # Llama 3.3 / Gemini intent-filtered context builder
│   └── blindBallotService.js   # Cryptographic token decoupling & double-vote prevention
│
├── middleware/                 # SERVER UTILITIES
│   ├── httpHelpers.js          # JSON parser, body reader, cookie parser
│   └── session.js              # 30-day session issuance & Bearer token extraction
│
├── docs/                       # SYSTEM DOCUMENTATION
│   ├── 01_ARCHITECTURE_OVERVIEW.md
│   ├── 02_AUTHENTICATION_SECURITY.md
│   ├── 09_OAUTH_AUTHENTICATION_AND_PERSISTENCE_FIXES.md
│   └── ...
│
├── server.js                   # Local Node.js HTTP server entry point
├── db.js                       # Local SQLite connection & schema seeding (better-sqlite3)
├── test_prototype.js           # 20-point automated integration & security test suite
├── schema.sql                  # Canonical database schema DDL
└── package.json                # Dependencies (only better-sqlite3 for local dev)
```

---

## 5. Engineering Standards & "Do's and Don'ts"

### ✅ DO:
1. **Preserve the Zero-Dependency Mandate**: Do not introduce heavy frontend frameworks (React, Vue, Tailwind) or bloated npm dependencies. Vanilla ES modules and standard CSS provide instant load times and permanent maintainability.
2. **Support Dual Persistence**: When making API calls, use standard `fetch()`. The universal interceptor in `public/app.js` will automatically attach `Authorization: Bearer <token>` from `localStorage` while retaining cookie compatibility.
3. **Keep SQL Queries Synchronized**: If you modify or add an endpoint in `routes/*.js` for localhost, ensure the equivalent query is mirrored in `functions/api/[[catchall]].js` for Cloudflare D1.
4. **Use Optimistic Concurrency Control (OCC)**: When updating tasks, always check `version = ?` and increment `version + 1` to prevent concurrent teammate collisions.

### ❌ DO NOT:
1. **Never commit directly to `main`**: All code destined for `main` must pass through a Pull Request from `develop`.
2. **Never commit secrets**: Do not hardcode API keys or credentials in code files. Use `.env` locally and Cloudflare Worker Environment Variables in production.
3. **Do not use emojis in the UI**: Frontier AI adheres to a strict, professional Google Workspace aesthetic (Google Blue `#8ab4f8`, Surface `#1e1f20`, Text `#e3e3e3`). Use clean SVGs from the icon palette instead.

---

## 6. Helpful Commands Reference

```bash
# Check JavaScript syntax across modified files
node --check public/app.js
node --check functions/api/[[catchall]].js
node --check routes/authRoutes.js

# Run full automated test suite
node test_prototype.js

# Check git status cleanly
git status -s

# Discard local file changes if you made a mistake
git restore <path/to/file>
```

Happy coding! If you have questions about architecture, consult the [docs/](docs/) directory or ask in the team workspace.
