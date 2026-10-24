# Frontier AI — Authentication, Sessions & Security Architecture

## 1. The GitHub Immutable Numeric Allowlist

### 1.1 The Vulnerability with Username-Based Authentication
Many applications restrict access by checking GitHub usernames:
```javascript
// INSECURE PATTERN
if (user.username === 'alice_v') { grantAccess(); }
```
**Why this is dangerous:**
Any registered user on GitHub can change their username at any time in account settings. If a team member leaves or renames their account, an unauthorized third party could register the abandoned username and immediately gain full administrative privileges.

### 1.2 Our Solution: Immutable Numeric IDs
When an account is created on GitHub, it is assigned a permanent, non-reassignable **numeric ID** (e.g., `10101`, `10102`). This integer is burned into GitHub's database forever.

In Frontier AI, the `members` database table explicitly defines the authorized 8 members by both their current handle and their immutable numeric GitHub ID:

```sql
CREATE TABLE members (
  id INTEGER PRIMARY KEY,
  github_numeric_id INTEGER UNIQUE,
  handle TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  team_track TEXT NOT NULL,
  is_host INTEGER DEFAULT 0,
  is_allowed INTEGER DEFAULT 1
);
```

### 1.3 The Allowlist Verification Pipeline
1. The user authenticates with GitHub via OAuth 2.0 (`/api/auth/github`).
2. GitHub returns the profile payload containing the numeric `id`.
3. The server queries the database:
   ```sql
   SELECT * FROM members WHERE github_numeric_id = ? AND is_allowed = 1;
   ```
4. **If matched:** An authenticated session is created.
5. **If NOT matched:** The server immediately returns `403 Forbidden` (`unauthorized_allowlist`), and records a high-severity security event in the audit log.

### 1.4 Public Data Sanitization
To prevent reconnaissance, public API endpoints (`GET /api/members`) strip all sensitive numeric GitHub IDs for unauthenticated visitors, returning only public team info (name, handle, role, team track).

---

## 2. Persistent SQLite Sessions

### 2.1 The Problem with In-Memory Sessions
Early prototypes often store sessions in memory:
```javascript
const memorySessions = new Map(); // Lost on server crash or reboot
```
If the server restarts, every team member is unceremoniously logged out.

### 2.2 SQLite-Backed Session Table
Frontier AI uses an indexed table inside `frontier.db`:
```sql
CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES members(id)
);
CREATE INDEX idx_sessions_token ON sessions(token);
```

When a user signs in:
1. The server generates a high-entropy 64-character hexadecimal token using `crypto.randomBytes(32).toString('hex')`.
2. The session record is saved in SQLite with a 7-day expiration timestamp (`expires_at`).
3. The token is sent to the client as an `HttpOnly`, `SameSite=Lax` cookie.
4. On subsequent requests, the server looks up the token with an indexed query. If the session has expired, it is purged automatically.

---

## 3. Role-Based Access Control (RBAC)

The team consists of 8 individuals with distinct responsibilities:
- **1 Team Lead (Alice Vance):** Authorized host with administrative authority.
- **7 Team Members (Bob Ross, Charlie Park, Dana Lee, Ethan Hunt, Fiona Gallagher, George Clark, Hannah Abbott):** Active project contributors.

### RBAC Permission Matrix

| Capability | Team Lead (Host) | Team Member (Participant) | Enforcement Mechanism |
|---|---|---|---|
| **Allot Sprint Tasks & Set Deadlines** | Yes | No | Backend checks `currentUser.is_host === 1`; returns `403` if false. |
| **Schedule Calendar Calls** | Yes | No | Backend checks `currentUser.is_host === 1`; returns `403` if false. |
| **Manage & Reopen Peer Review Sessions** | Yes | No | Backend checks `currentUser.is_host === 1`; returns `403` if false. |
| **Inspect Tamper-Evident Audit Log** | Yes | No | Backend checks `currentUser.is_host === 1`; returns `403` if false. |
| **Export Disaster Recovery JSON Snapshots** | Yes | No | Backend checks `currentUser.is_host === 1`; returns `403` if false. |
| **Send & Receive Peer Tasklets** | Yes | Yes | Available to all authenticated team members. |
| **Submit Task Deliverables** | Yes | Yes | Assignee or lead can submit pull request links. |
| **Cast Anonymous Review Ballots** | Yes (1 vote) | Yes (1 vote) | Blind HMAC token decouples member identity from vote. |
| **Join Scheduled Calls** | Yes | Yes (if in audience) | Validated against `target_audience` allowlist. |

---

## 4. Two-Person Rule Governance ("Four-Eyes Principle")

### 4.1 Concept
In high-security engineering environments, no individual should possess unilateral authority to perform sensitive administrative operations (such as modifying allowlists, granting elevated roles, or tampering with database entries).

### 4.2 The Access Ticket State Machine
```
[User Submits Ticket]
        │
        ▼
   (PENDING_APPROVAL)
        │
        ├── Author attempts approval ───> 403 Forbidden ("Self-approval prohibited")
        │
        └── Independent Peer approves ──> (APPROVED)
                                              │
                                              ▼
                                      [Temporary Access Granted]
                                              │
                                       (Timer Expires)
                                              │
                                              ▼
                                          (EXPIRED)
```

1. **Submission (`POST /api/tickets`):** The requester provides a title, scope (e.g., `MEMBERSHIP_ADMIN`), justification, and duration in minutes.
2. **Anti-Self-Approval Guard (`POST /api/tickets/:id/approve`):**
   ```javascript
   if (ticket.requester_id === currentUser.id) {
     return sendJson(res, 403, { error: 'Self-approval is strictly forbidden under the two-person governance policy.' });
   }
   ```
3. **Audit Trail Logging:** Both the request and the approving peer's identity are recorded in the security ledger.

---

## 5. Tamper-Evident Security Audit Log

All critical platform actions are written to an append-only `audit_logs` table:
```sql
CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  actor_handle TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  severity TEXT DEFAULT 'INFO',
  details TEXT
);
```

- **Events Logged:**
  - Login attempts (successful logins, invalid credentials, allowlist rejections).
  - Task creation, status updates, and OCC concurrency conflicts.
  - Call room pings, joins, and conclusions.
  - Blind token claims, anonymous ballot submissions, session close and reopen events.
  - Two-person access ticket creation and peer approvals.
  - Database snapshot generations.
- **Lead-Only Access:** Authenticated endpoints strictly gate log visibility to `currentUser.is_host === 1`.

---

## 6. Google OAuth 2.0, Stateless HMAC-SHA256 & Dual-Persistence Architecture

For modern zero-trust enterprise and Google Workspace environments, Frontier AI implements Google OAuth 2.0 alongside GitHub authentication:

### 6.1 Stateless HMAC-SHA256 OAuth CSRF Protection
Rather than storing `oauth_state` in volatile cross-site cookies that are frequently partitioned or stripped during external identity provider redirects, the server issues a self-verifying cryptographic state:
$$\text{state} = \text{nonce} \,.\, \text{timestamp} \,.\, \text{HMAC-SHA256}(\text{secret}, \text{nonce} + \text{timestamp})$$
- **Immune to multi-click race conditions:** Any valid state generated within a 15-minute sliding window is accepted.
- **Zero cross-site cookie dependency:** Does not fail when modern privacy shields (Safari ITP, Chrome Incognito, Brave) isolate third-party cookies.

### 6.2 Dual-Persistence Session Engine (Bearer + Cookie)
To guarantee persistent sessions across browser restarts, subdomains (`*.pages.dev`), and iframe embeddings:
1. **Server Channel:** Sets a 30-day `HttpOnly; SameSite=Lax; Secure` session cookie.
2. **Client Channel:** Returns `sid` in the OAuth redirect URL, which is saved in `localStorage`.
3. **Universal Fetch Interceptor:** Automatically injects `Authorization: Bearer <token>` on all outbound `/api/` calls.
4. **Server Resolution:** Backends inspect `Authorization: Bearer <token>` first, falling back to `cookies.frontier_session`.

### 6.3 Dynamic Access Requests & Host Approval Workflow
Instead of rigid hardcoded account lists, unlisted Google accounts are placed into a `Pending Review` state (`is_allowed = 0`). The Team Lead receives real-time pending badges and can approve or deny access directly within the platform.

*(For the complete technical post-mortem, mathematical formulation, and codebase diff, refer to [09. OAuth & Session Persistence Fixes](09_OAUTH_AUTHENTICATION_AND_PERSISTENCE_FIXES.md).)*
