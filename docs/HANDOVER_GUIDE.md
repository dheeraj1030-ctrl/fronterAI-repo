# Frontier AI — Engineering Architecture & Handover Blueprint
**Target Audience**: Frontend Engineers, Backend/Edge Engineers, DevOps, Project Evaluators.  
**Platform URL**: Cloudflare Pages + Cloudflare D1 Edge SQLite  
**Design Paradigm**: Flat Google Workspace Dark Theme (`#131314` canvas, `#1e1f20` cards, `#28292a` elevation). Zero Emojis.

---

## 1. System Philosophy & Non-Negotiable Constraints

1. **Permanent Zero-Cost (₹0) Footprint**:
   - Hosted serverlessly on Cloudflare Pages Functions + Cloudflare D1 (SQLite) with automatic fallbacks for local Node.js development.
   - Zero paid third-party software, zero paid databases, and zero npm client dependencies.
2. **Google Workspace Design Language**:
   - High visual density, restrained typography (Inter, Google Sans, monospace for IDs/hashes), flat card containers with 1px border dividers (`#3c4043` / `#303134`).
   - Strictly **zero emojis** in UI labels, notification banners, action buttons, or codebase messages.
3. **Cryptographic Integrity & Blind Accountability**:
   - Anonymous reviews are decoupling voter identity from cast ballots via blind HMAC-SHA256 tokens.
   - Governance follows the Two-Person Rule for all critical deliverable approvals.

---

## 2. Directory Structure & Architectural Topology

```text
fronterAI-repo/
├── functions/                     # Cloudflare Pages Functions (Edge Serverless Runtime)
│   └── api/
│       └── [[catchall]].js        # Edge API Gateway routing all /api/* requests to D1
├── routes/                        # Local Node.js Route Handlers (Development Parity)
│   ├── aiRoutes.js                # Oracle AI endpoints (Chat, History, Thread Deletion)
│   ├── authRoutes.js              # Google OAuth 2.0 & Session Management
│   ├── calendarRoutes.js          # Google Meet slots & Call Room coordination
│   ├── memberRoutes.js            # Team Directory & Allowlist verification
│   ├── taskRoutes.js              # Tasks, Two-Person Sign-Offs, OCC conflict inspector
│   └── votingRoutes.js            # Blind HMAC peer review & aggregate tallying
├── services/                      # Shared Domain Services (Node.js)
│   ├── aiService.js               # Intent-based context filter, Groq / Gemini integration
│   └── cryptoService.js           # HMAC-SHA256 blind token generation & verification
├── public/                        # Frontend Static Client
│   ├── index.html                 # Single Page Application HTML shell
│   ├── styles.css                 # Unified Google Workspace dark theme CSS tokens
│   └── app.js                     # Client state manager, view router & event handlers
├── docs/                          # Comprehensive Module Deep-Dives
│   ├── 01_ARCHITECTURE_OVERVIEW.md
│   ├── 02_AUTHENTICATION_SECURITY.md
│   ├── 03_TASKS_AND_TASKLETS.md
│   ├── 04_CRYPTOGRAPHIC_PEER_REVIEW.md
│   ├── 05_CALL_ROOM_AND_EMBEDDED_MEET.md
│   ├── 06_DEPLOYMENT_AND_MIGRATION_GUIDE.md
│   ├── 07_AI_ORACLE_MEMORY_AND_MODULAR_ARCHITECTURE.md
│   ├── 08_CLOUDFLARE_D1_HOSTING_GUIDE.md
│   └── HANDOVER_GUIDE.md          # This Document
├── db.js                          # Local SQLite connection (better-sqlite3) with WAL mode
├── schema.sql                     # Canonical DDL Schema for SQLite & Cloudflare D1
└── server.js                      # Local development HTTP server (Zero npm dependencies)
```

---

## 3. Frontend Architecture Handover

### Global State Store (`public/app.js`)
All client-side reactive state lives inside the centralized `state` singleton object:
```javascript
const state = {
  currentUser: null,       // Session user profile (id, name, role, is_host, etc.)
  tasks: [],               // Sprint tasks with OCC versioning
  tasklets: [],            // Peer-to-peer micro-tasks
  calendarEvents: [],      // Scheduled and live meetings
  meetingSlots: [],        // 6 Google Meet bridge slots
  votingSession: null,     // Active/closed review round, eligible candidates, tallies
  unlinkedBallotToken: '', // Blind cryptographic HMAC token cached in memory/sessionStorage
  oracleThreads: [],       // Conversation threads for Oracle AI
  currentOracleThreadId: null, // Active conversation thread
  auditEvents: [],         // Immutable security logs
  members: []              // Allowlisted team roster
};
```

### Key UI Subsystems & Rules
1. **View Router (`switchView(viewId)`)**:
   - Toggles visibility across `workspace-view` containers (`view-tasks`, `view-callroom`, `view-voting`, `view-peers`, `view-settings`, `view-oracle`).
   - Automatically synchronizes sidebar navigation pills and runs view-specific fetchers.
2. **Command Palette (`Ctrl+K`)**:
   - Bound globally to `window.addEventListener('keydown')`.
   - Handles `Escape` dismissal cleanly and navigates directly to any view or triggers actions (e.g. `/call`, `/vote`).
3. **Peer Review Roster & Self-Eval Exclusion**:
   - In individual teammate reviews, the logged-in user is flagged with `.cand-badge-self` and excluded from selection.
   - If `evaluableCount === 0` (e.g. only 1 team member), the UI displays a clean explanation card and prevents empty submissions.
4. **Oracle AI Thread Lifecycle**:
   - Threads list renders with individual trash icons (`.oracle-thread-del-btn`).
   - Top action bar includes `Clear All` for irreversible thread purging.

---

## 4. Backend & Edge Handover

### Data Feeding to Frontier Oracle AI
To prevent LLM token blowups and hallucinations, data feeding follows a **Sliding Context Window + Intent-Based Filtering** pattern:

```text
[User Types Message]
        │
        ▼
[/api/ai/chat] ────► Check Message Keywords
        │
        ├── Contains "task/todo/deadline"?  ──► Query tasks table (LIMIT 15, ordered by deadline)
        ├── Contains "meet/call/bridge"?    ──► Query meeting_slots table (LIMIT 6)
        └── Contains "team/member/who"?     ──► Query members directory
        │
        ▼
Assemble Compressed System Prompt (Zero verbose prose)
        │
        ▼
Load Last 6 Turns from `ai_messages` for this thread (Sliding Window)
        │
        ▼
Dispatch payload to Groq API (Llama 3.3 70B / 3.1 8B)
        │
        ▼
Persist user turn + model turn to SQLite D1 with timestamp
```

### Cryptographic Peer Review (HMAC-SHA256 Blind Ballot)
1. **Token Request (`POST /api/voting/blind-token`)**:
   - Verifies the user is an authenticated team member who hasn't already voted in this round.
   - Computes: `HMAC_SHA256(SECRET, session_id + ":" + random_uuid + ":" + nonce)`.
   - Stores the hashed token hash in `voting_tokens` as *issued*.
   - Returns the token to the client.
2. **Ballot Submission (`POST /api/voting/ballot`)**:
   - Client sends `{ token, candidateId, rating, feedbackCategory }`.
   - Server re-hashes the token and verifies it was issued and unconsumed.
   - Marks token as *consumed*.
   - Records the rating into `ballots` with **zero reference to `member_id`**.
   - Identity linkage is mathematically severed.

---

## 5. Database Schema & Migration Notes

The canonical schema is defined in [schema.sql](file:///c:/Users/GIGA/Desktop/fronterAI-repo/schema.sql).
When provisioning new tables or deploying to Cloudflare D1:
```bash
# Execute local schema
sqlite3 frontier.db < schema.sql

# Execute Cloudflare D1 edge migration
npx wrangler d1 execute frontier-db --file=schema.sql
```

Key tables:
- `members`: Allowlisted roster with `google_sub` (OAuth) and `numeric_github_id`.
- `sessions`: Bearer session tokens with explicit expiration dates.
- `tasks`: Formal sprint deliverables with OCC `version` integer for concurrent edit protection.
- `voting_sessions` & `ballots`: Blind review state and anonymous 1–5 star ratings.
- `ai_threads` & `ai_messages`: Oracle conversation threads with cascading deletion.
- `audit_events`: Tamper-evident activity logs recording security events.

---

## 6. How to Run & Verify

```bash
# 1. Start local development server (Node.js standard library, zero dependencies)
node server.js

# 2. Run automated test suite (20 automated end-to-end checks)
node test_prototype.js

# 3. Cloudflare Pages Functions local emulation
npx wrangler pages dev public
```
