# Frontier AI — Engineering Handover & Context Brief

> **Context**: This document provides a complete transfer of context from the laptop development session to the PC session. It details the architecture, implemented security features, branching structure, and exact steps to merge the PC's visual/frontend changes with the laptop's zero-dependency backend and GitHub OAuth engine.

---

## 1. Executive Summary & Repository Status

- **Repository**: `git@github.com:potatobun321/fronterAI-repo.git`
- **Core Design Mandate**: ₹0 hosting and runtime costs, zero external npm libraries or SaaS dependencies (`node:http`, `node:sqlite` via `DatabaseSync`, `node:crypto`), vanilla HTML5/CSS3/ES Modules frontend, no emojis, professional Google Workspace aesthetic.
- **Active Branches on GitHub**:
  - `main`: Contains the baseline platform, clean slate database state, and automated member onboarding.
  - `feature/backend-oauth-allowlist`: Dedicated feature branch holding the complete backend, OAuth 2.0 flow, and security gating suite.
  - `pc-visuals` (to be pushed from PC): Will contain the visual styling, UI improvements, and CSS updates made on the PC.

---

## 2. Key Architecture & Features Completed on Laptop

### A. Real GitHub OAuth 2.0 & Session Security
- **OAuth App Registration**:
  - **Client ID**: `Ov23ctd83ckd7wvtNcqy`
  - **Redirect URI**: `http://localhost:3030/api/auth/github/callback`
  - **Scope**: `read:user` (Strictly public profile metadata: username, avatar, numeric ID).
  - **Zero Code Access**: GitHub's consent dialog explicitly states: *Personal user data: read-only. No access to repositories, code, or organizations.*
- **Cryptographic Session Store**:
  - In `server.js`, logins generate a 256-bit random hex token (`crypto.randomBytes(32).toString('hex')`).
  - Stored in a server-side `sessions` Map and sent as an `HttpOnly; SameSite=Lax` cookie named `frontier_session`.
  - Replaces all legacy global session variables to prevent concurrent session bleed.

### B. Immutable Numeric ID Allowlist Gating
- Authentication is gated against GitHub's permanent numeric `id` (e.g. `194890859`), **never** against mutable username strings.
- Non-allowlisted GitHub users receive an HTTP 403 Forbidden with a security alert banner (`OAUTH_ALLOWLIST_DENIED`), preventing internet strangers from entering the workspace.

### C. Clean Slate Database State (Zero Mock Data)
- **Active Member in SQLite (`frontier.db`)**:
  - **ID**: `1`
  - **Name**: Kartikay
  - **GitHub Handle**: `potatobun321`
  - **GitHub Numeric ID**: `194890859`
  - **Role**: `Team Host & Lead` (holds `is_host = 1` Authorator privileges).
- All 8 mock personas (`Alice Vance`, `Bob Ross`, etc.) and mock test tasks/events have been cleared.
- Seeded with 1 starter workspace task and 1 kickoff calendar sync.

### D. Automated Host Onboarding API (`POST /api/members`)
- Teammates do not need to create `.env` files or register OAuth credentials.
- In **Team Directory**, the Host clicks **+ Onboard Member** and inputs a teammate's GitHub handle (e.g., `octocat`) and role.
- The server calls `https://api.github.com/users/{username}`, retrieves their verified profile and numeric ID, and stores them via **parameterized SQL prepared statements**:
  ```javascript
  const stmt = db.prepare(`
    INSERT INTO members (github_numeric_id, handle, name, role, team_track, is_host, is_allowed)
    VALUES (?, ?, ?, ?, ?, 0, 1)
  `);
  stmt.run(numericId, sanitizedUsername, displayName, role, validTrack);
  ```
- **100% SQL-Injection Immune**: Parameters are treated strictly as data bytes by SQLite's pre-compiled instruction tree.

### E. Masked Google Meet Bridges & Calendar Juggling
- **6 Pre-allocated Google Meet Links** stored in `meeting_slots` (`SLOT-01` to `SLOT-06`):
  - `https://meet.google.com/kuw-amav-swf`
  - `https://meet.google.com/mzs-atxy-yja`
  - `https://meet.google.com/sdj-njyx-bwm`
  - `https://meet.google.com/zky-swdi-phk`
  - `https://meet.google.com/nvr-adyb-wmb`
  - `https://meet.google.com/sae-wkpe-rth`
- **Masking Gateway**: Client UI only sees internal URLs (`/api/meetings/join/:id`). Raw Google Meet links are never exposed to client-side DOM or network inspection.
- **Least-Recently-Used Rotation**: When the Host schedules a meeting, the system auto-juggles between the 6 slots based on `last_used_at`.
- **Target Audience Ping**: Supports `ALL`, `BACKEND`, `FRONTEND`, or targeted member subsets.

### F. Cryptographic Blind Voting & Disaster Recovery
- Blind token protocol decouples voter identity from the ballot box.
- Authorator Git Disaster Recovery (`POST /api/disaster-recovery/export`) dumps a clean JSON snapshot of all 11 database tables to `backups/` on demand.

### G. Automated Test Suite
- `node test_prototype.js` tests all 13 core architecture checks against the live server. All 13 tests pass 100%.

---

## 3. Local Environment Setup on PC

Create a local `.env` file on your PC in the repository root (this file is ignored by `.gitignore`):

```env
PORT=3030
BASE_URL=http://localhost:3030
GITHUB_CLIENT_ID=Ov23ctd83ckd7wvtNcqy
GITHUB_CLIENT_SECRET=0044526cf8efa8bd1337b6a2736bfa42098a2f48
```

---

## 4. Instructions for Continuing Work on the PC

### Step 1: Push Your PC's Visual Changes to a Feature Branch
In the terminal on your PC inside the project directory:

```bash
# 1. Switch to a new branch for your PC's work
git checkout -b pc-visuals

# 2. Stage and commit your changes
git add .
git commit -m "feat: PC visual overhaul and layout styling"

# 3. Push to GitHub
git push -u origin pc-visuals
```

### Step 2: Fetch the Laptop's Backend Feature Branch
```bash
git fetch origin
```

### Step 3: Inspect the Diffs Between Visuals and Backend
```bash
# Compare styling changes
git diff origin/feature/backend-oauth-allowlist..pc-visuals -- public/styles.css

# Compare HTML structure changes
git diff origin/feature/backend-oauth-allowlist..pc-visuals -- public/index.html
```

### Step 4: Merge the Visual Work onto the Backend Branch
```bash
# Checkout the backend feature branch
git checkout feature/backend-oauth-allowlist

# Merge or cherry-pick the visual updates from pc-visuals
git merge pc-visuals
```
*Note*: During the merge, accept the PC's styling updates in `public/styles.css` and layout elements in `public/index.html`, while preserving the backend endpoints in `server.js` and `db.js`, the onboarding modal dialog in `public/index.html`, and the API handlers in `public/app.js`.

### Step 5: Verify & Test Everything
```bash
# Start server
node server.js &

# Run verification suite
node test_prototype.js

# Test in browser
# Open http://localhost:3030 and test GitHub login, meeting bridges, and the newly styled views!
```

---

## 5. Ready-to-Paste Prompt for Your PC AI Assistant

When starting your chat on the PC, copy and paste this exact prompt:

```text
We are working on the Frontier AI platform. The laptop branch has completed the zero-dependency Node.js backend, real GitHub OAuth 2.0 flow, strict numeric ID allowlist gating, automated member onboarding, and masked Google Meet bridges on branch 'feature/backend-oauth-allowlist'.

On this PC, we worked on visual layout and CSS improvements on branch 'pc-visuals'.

Please read HANDOVER_CONTEXT.md in the repository root to see the full architecture specifications. Let's compare 'pc-visuals' with 'origin/feature/backend-oauth-allowlist', merge the visual styling improvements cleanly without touching the backend security and allowlist handlers, verify with 'node test_prototype.js', and test the unified application on localhost:3030.
```
