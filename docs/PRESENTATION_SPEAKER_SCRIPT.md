# Frontier AI — Presentation Speaker Script & Demo Guide

This document is your spoken cheat-sheet for the project presentation and live demo. It is written in simple, conversational language so you can read through it naturally while presenting your screen.

---

## 1. The 30-Second Opening (The Hook)

> **What to Say:**
> "Hello everyone. Today we are presenting **Frontier AI**, an internal engineering workspace built specifically for student development teams. 
> 
> When small teams build software together, they usually juggle five disconnected tools: Jira for tasks, Slack for chat, Google Meet links scattered across WhatsApp, and Google Forms for peer reviews. These tools either cost money after a trial, leak meeting links, or make team accountability messy.
> 
> We built Frontier AI to solve this with three core principles:
> 1. **Zero Budget (Permanent ₹0 Spend):** Runs on standard Node.js with zero npm dependencies locally, and deploys to Cloudflare's permanent free tier.
> 2. **Role-Adaptive Simplicity:** Team leads get sprint governance; members get peer-to-peer micro-tasks without corporate bloat.
> 3. **Real Engineering Rigor:** Mathematical blind voting for anonymous reviews, optimistic concurrency control to prevent overwritten tasks, and an immutable audit trail."

---

## 2. Live Demo Walkthrough (Click & Speak)

Follow this sequence on your screen while explaining each concept:

```
[Screen: Login Page]
```

### Scene 1: Hard Allowlist & Numeric GitHub IDs
- **What to Click:** Show the login screen with the member cards.
- **What to Say:**
  > "First, security. Most student projects store usernames. But on GitHub, anyone can change their username in two clicks to impersonate someone else. 
  > 
  > Frontier AI uses permanent **numeric GitHub IDs** verified against a hardcoded team allowlist of 8 members. Even if an attacker renames their GitHub account to match our team lead, the server checks the numeric ID at the protocol level and rejects them with HTTP 403.
  > 
  > Let's log in first as **Alice Vance**, our Project Lead."

---

```
[Screen: Alice Vance Dashboard]
```

### Scene 2: Role-Adaptive Workspace (Lead vs. Member)
- **What to Click:** Point out the left sidebar navigation items.
- **What to Say:**
  > "Notice the sidebar. As the Team Lead, Alice sees:
  > - **My Work** (personal deliverables)
  > - **Tasks** (formal sprint planning)
  > - **Call Room** (team sync coordination)
  > - **Peer Review** (evaluation rounds)
  > - **Settings & Logs** (administrative audit trail and permissions)
  > 
  > Regular members do not see administrative settings. Instead, their 4th sidebar item is **Peers**, which gives them a direct pipeline to send micro-tasks to each other. Every person gets an interface fitted to what they actually need."

---

```
[Screen: Tasks Kanban Board]
```

### Scene 3: Formal Sprint Tasks & Concurrency Protection
- **What to Click:** Navigate to **Tasks** -> **All Team Tasks (Kanban Board)**.
- **What to Say:**
  > "Here is our formal sprint board. Notice that each column has calibrated dimensions so two full tasks fit cleanly without text being cut in half, and descriptions clamp at 3 lines.
  > 
  > In collaborative projects, what happens if two developers edit the same task at the same second? Usually, the last write silently overwrites the first. That is called the 'Lost Update' problem.
  > 
  > Frontier AI implements **Optimistic Concurrency Control (OCC)**. Every task carries an atomic version counter. If someone tries to update a task that was already changed on the server, the server blocks it with an HTTP 409 Conflict and pops open a visual side-by-side reconciliation window showing both versions so no work is ever destroyed."

---

```
[Screen: Peers Module (Switch to Bob Ross if demonstrating)]
```

### Scene 4: Informal Peer Tasklets (Member-to-Member)
- **What to Click:** Explain the difference between formal tasks and peer tasklets.
- **What to Say:**
  > "Formal tasks are assigned by the Team Lead for sprint deliverables. But during actual coding, teammates constantly ask each other: *'Can you review my PR?'* or *'Can you test this database query on Windows?'*
  > 
  > We built **Peer Tasklets**. Any team member can send a micro-task directly to any teammate. The recipient gets an unread badge, accepts it, and marks it done. It keeps casual peer requests organized without polluting the formal sprint deliverable board."

---

```
[Screen: Call Room]
```

### Scene 5: Call Room & Google Meet Companion Gateway
- **What to Click:** Click **Call Room** in the sidebar. Show the hero card and the sidebar color. Then toggle sidebar collapse to show the clean mini circle.
- **What to Say:**
  > "Next is the **Call Room**. Real-time video APIs like Twilio or Agora charge per minute, which is impossible on a zero-dollar student budget. But manually pasting Google Meet links in chat groups leads to link leakage, outsiders joining, and zero attendance tracking.
  > 
  > We solved this with a **Server Gateway**:
  > 1. We pre-provision **6 Google Meet bridge slots** in the database and rotate them using a Least-Recently-Used algorithm so calls never collide.
  > 2. The sidebar dynamically shows room state: **Green** when a call is live, **Amber/Yellow** when scheduled, and **Blue** when idle. In mini-sidebar mode, the circle itself takes the state color cleanly.
  > 3. When a member clicks **'Join Google Meet ↗'**, the request hits `/api/meetings/join/:id`. Our server checks your session, verifies you are on the guest list, logs your verified attendance in the audit ledger, and redirects you directly into the Google Meet room in a companion tab.
  > 
  > Why a companion tab instead of an embedded iframe? Google strictly serves `X-Frame-Options: SAMEORIGIN` security headers that block all external websites from iframing Meet. Rather than showing a broken frame or fake audio waveforms, our companion model gives real HD video powered by Google while keeping the workspace open on your screen for tasks and agendas."

---

```
[Screen: Peer Review View]
```

### Scene 6: Cryptographic Anonymous Peer Review (Blind HMAC Protocol)
- **What to Click:** Navigate to **Peer Review**. Show Step 1 ("Get Secret Ballot") and Step 2 ("Cast Ballot").
- **What to Say:**
  > "Now for our most important feature: **Anonymous Peer Review**.
  > 
  > In college projects, peer feedback is usually dishonest because students fear social backlash if their name is attached to a critical review. But if you make it completely anonymous, people can vote multiple times or outsiders can spam the ballot.
  > 
  > We solved this with a **Two-Phase Blind Ballot Protocol using HMAC-SHA256**:
  > - **Phase 1 (Eligibility Stamp):** The member clicks 'Get Secret Ballot'. The server marks in the eligibility ledger that this member claimed their ticket. The server issues a cryptographically signed HMAC token containing an ephemeral random nonce, but **zero member identity**.
  > - **Phase 2 (Anonymous Drop):** The browser casts the vote containing only the candidate selection and the token. The ballot box stores the vote with no link to who cast it.
  > 
  > **The result:** The system mathematically guarantees that only verified members can vote, each member can only vote once (tokens are hashed into a spent-token ledger), and **nobody—not even the database administrator—can link a vote back to the person who cast it**."

---

```
[Screen: Settings & Logs (Alice Vance)]
```

### Scene 7: Two-Person Rule & Security Audit Trail
- **What to Click:** Click **Settings & Logs** -> **Audit Log** tab.
- **What to Say:**
  > "Finally, team governance. We implement the **Two-Person Rule (Four-Eyes Principle)**. No developer can unilaterally grant themselves elevated privileges. An engineer must raise an Access Ticket, and self-approval is blocked in code—a second team member must approve it.
  > 
  > Every single action—logins, failed authorization attempts, meeting joins, ballot claims, and task updates—is written to an append-only **Security Audit Trail** that only the Team Lead can inspect. 
  > 
  > And with one click, the lead can trigger a clean JSON snapshot for emergency Git disaster recovery."

---

## 3. Technology Stack & Zero-Cost Architecture (The Technical Slide)

When explaining how it is built, use these clear points:

| Layer | Implementation | Why We Chose It |
|---|---|---|
| **Frontend** | Vanilla HTML5, CSS3, ES Modules | Boots in under 50ms. No build steps, no framework churn, 0 npm vulnerabilities. |
| **Backend** | Node.js Standard Library (`node:http`, `node:crypto`, `node:sqlite`) | **Zero npm dependencies (`node_modules`: 0 bytes)**. Immune to supply-chain attacks. |
| **Database** | SQLite with Write-Ahead Logging (WAL) | Lightweight, single-file ACID transactions. Compatible 1:1 with Cloudflare D1 SQL. |
| **Production Target** | Cloudflare Pages + Workers + D1 | **Permanent ₹0 spend forever** (100,000 free Worker requests/day, 5M free D1 read rows/day). |

---

## 4. Tough Questions Judges / Teachers Might Ask & Exact Answers

### Q1: "Why did you build your own platform instead of using Slack and Jira?"
> **Answer:** 
> "Commercial platforms are built for corporations with budgets. For student teams, they either impose trial expirations, limit message history, or lack our core requirements: cryptographic blind peer reviews, two-person access governance, and zero-cost meeting coordination with attendance logging."

### Q2: "Can the database administrator figure out who voted for whom in the peer review?"
> **Answer:** 
> "No, it is mathematically impossible. The eligibility table records that Member A claimed a ballot. But the ballot box only stores the candidate choice and the HMAC token signature. There is no foreign key, no user ID, and no correlation timestamp connecting the two tables."

### Q3: "What prevents someone from reusing their blind ballot token twice?"
> **Answer:** 
> "Double-voting prevention is enforced in the database. When a ballot is cast, the SHA-256 hash of the token is written to a `used_tokens` table. If someone replays the exact same token, the database triggers a unique constraint violation and rejects it with an HTTP 409 Conflict."

### Q4: "Why does the meeting open in a companion window instead of an iframe?"
> **Answer:** 
> "Google Meet strictly enforces `X-Frame-Options: SAMEORIGIN` and Content Security Policies. Modern browser engines block third-party websites from rendering Google Meet in an iframe to prevent clickjacking and credential theft. Our pop-out gateway provides genuine HD multi-user video at zero cost while maintaining verified attendance logging on our server."

### Q5: "Would switching to Google Login allow embedding Google Meet inside the page?"
> **Answer:** 
> "No. Google OAuth verifies user identity, but Google Meet's `X-Frame-Options` rule is enforced by Google's servers regardless of login method. If 100% in-browser video is ever mandated, the open-source Jitsi Meet API provides a free WebRTC drop-in solution."

### Q6: "Why did you avoid third-party npm packages?"
> **Answer:** 
> "Three reasons:
> 1. **Security:** Modern web applications suffer from supply-chain attacks in unvetted npm dependencies. With zero packages, our attack surface is minimal.
> 2. **Speed:** The backend boots in under 15 milliseconds.
> 3. **Longevity:** There are no breaking library updates or abandoned packages. The code will run ten years from now just as reliably as today."

---

## 5. Quick Closing Sentence

> **What to Say:**
> "Frontier AI proves that student engineering teams don't need expensive enterprise subscriptions to have professional security, transparent governance, and honest peer collaboration. Thank you, and we are ready for your questions."
