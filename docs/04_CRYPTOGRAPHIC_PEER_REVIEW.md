# Frontier AI — Cryptographic Peer Review & Evaluation Protocol

## 1. The Small-Team Anonymity Dilemma

In an 8-person engineering team, peer evaluations are critical for accountability, merit recognition, and grading. However, candid evaluations are easily compromised by social friction:
- If votes are linked to user accounts in the database (`ballots (voter_id, candidate_id)`), any member with database access (or the server host) can query who voted for whom.
- Conversely, if ballots are completely untracked, anyone can vote multiple times or stuff the ballot box.

**The Engineering Challenge:** How do we prove that *only* the 8 authorized members voted, exactly *once each*, without storing any linkage whatsoever between who claimed a ballot and which option they selected?

---

## 2. The Two-Phase Blind Ballot Protocol

Frontier AI implements a cryptographic two-phase blind token architecture powered by HMAC-SHA256 signatures:

```
===================================================================================
PHASE 1: PROVING ELIGIBILITY (IDENTIFIED STAGE)
===================================================================================
[Authenticated Member: Bob Ross]
               │
               ▼  POST /api/voting/token { session_id }
       +---------------+
       | Backend Check | ──> Is Bob in the allowlist?
       +---------------+ ──> Has Bob already claimed a token for this session?
               │
               ▼ (Eligible)
  1. Record Bob's claim: INSERT INTO voting_eligibility (session_id, member_id)
  2. Generate random 32-byte Nonce
  3. Sign token: Token = Nonce + "." + HMAC_SHA256(SecretKey, session_id + ":" + Nonce)
  4. Return Token to Bob's browser (stored in client sessionStorage)
  
  * NOTICE: The server does NOT record which token was given to Bob!
    The token contains zero identifiers related to Bob.

===================================================================================
PHASE 2: CASTING THE BALLOT (DECOUPLED ANONYMOUS STAGE)
===================================================================================
[Bob's Browser]
               │
               ▼  POST /api/voting/cast { session_id, option_id, token }
       +---------------+
       | Backend Check | ──> Is HMAC signature valid? (Proves server minted it)
       +---------------+ ──> Is SHA256(token) already in used_tokens? (Double-vote guard)
               │
               ▼ (Valid & Unspent)
  1. Record token as spent: INSERT INTO used_tokens (session_id, token_hash)
  2. Record anonymous vote: INSERT INTO ballots (session_id, option_id)
  3. Purge token from client sessionStorage
  
  * RESULT: Bob's identity is completely decoupled from the recorded ballot.
===================================================================================
```

---

## 3. Database Schema

```sql
-- Evaluation Sessions
CREATE TABLE voting_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  session_type TEXT DEFAULT 'PEER_PERFORMANCE', -- 'PEER_PERFORMANCE' or 'PROJECT'
  status TEXT DEFAULT 'OPEN',                   -- 'OPEN' or 'CLOSED'
  threshold INTEGER DEFAULT 8,
  created_at TEXT NOT NULL
);

-- Choices Available per Session
CREATE TABLE voting_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  label TEXT NOT NULL,
  candidate_member_id INTEGER,
  FOREIGN KEY (session_id) REFERENCES voting_sessions(id),
  FOREIGN KEY (candidate_member_id) REFERENCES members(id)
);

-- Phase 1 Ledger: Who has claimed their ballot token
CREATE TABLE voting_eligibility (
  session_id INTEGER NOT NULL,
  member_id INTEGER NOT NULL,
  claimed_at TEXT NOT NULL,
  PRIMARY KEY (session_id, member_id),
  FOREIGN KEY (session_id) REFERENCES voting_sessions(id),
  FOREIGN KEY (member_id) REFERENCES members(id)
);

-- Phase 2 Ledger: SHA-256 hashes of spent tokens
CREATE TABLE used_tokens (
  token_hash TEXT PRIMARY KEY,
  session_id INTEGER NOT NULL,
  used_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES voting_sessions(id)
);

-- The Anonymous Ballot Box (Zero member references)
CREATE TABLE ballots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  option_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES voting_sessions(id),
  FOREIGN KEY (option_id) REFERENCES voting_options(id)
);
```

---

## 4. Two Standardized Evaluation Templates

The system provides 2 distinct evaluation templates selectable via segmented tabs:

### Template 1: Peer Performance Review (`session_id = 1`)
- **Focus:** Teammate recognition, peer reliability, technical contribution, and sprint collaboration.
- **Ballot Options:** Dynamically populated from the `members` directory (showing each peer's name and team track).

### Template 2: Project Quality Review (`session_id = 2`)
- **Focus:** Overall assessment of the project codebase, architecture, reliability, and documentation deliverables.
- **Ballot Options:** 5 standardized quality tiers:
  - `5 Stars — Production Ready (Exceptional architecture & clean tests)`
  - `4 Stars — High Quality (Minor polish required)`
  - `3 Stars — Acceptable Prototype (Meets baseline specs)`
  - `2 Stars — Incomplete (Noticeable gaps in features or tests)`
  - `1 Star — Critical Deficits (Requires major refactoring)`

---

## 5. Client-Side Persistence & Lifecycle Controls

### 5.1 Token Caching across Page Reloads
Earlier web prototypes often lose uncast tokens if the student accidentally reloads the page or switches tabs. In Frontier AI:
1. When a token is claimed in Phase 1, it is immediately cached in `sessionStorage`:
   ```javascript
   sessionStorage.setItem('ballot_token_' + sessionId, token);
   ```
2. When the view is loaded or reloaded, the client automatically restores the token from `sessionStorage`, allowing the member to complete Step 2 (Casting Vote) without being locked out.
3. Upon successful ballot submission, the token is cleanly purged from `sessionStorage`.

### 5.2 Persistent Aggregate Results
- When a voting session is closed by the Team Lead (or reaches its participation threshold), the aggregate tally is revealed.
- The tally meters, percentage bars, and vote counts persist across page reloads and browser sessions.

### 5.3 Host Reopen Capability
If an evaluation round was closed prematurely or additional team members need to submit late feedback, the Team Lead can click **`Reopen Review`** (`POST /api/voting/reopen`), which resets `status = 'OPEN'` while preserving existing ballots and token hashes.
