# Frontier AI — Call Room & Google Meet Gateway Architecture

## 1. Zero-Cost Meeting Coordination

### 1.1 The Budget Dilemma
Live video calling APIs (Twilio, Agora, Daily.co) charge per-minute or per-participant rates that exceed a ₹0 college or bootstrapped project budget. Conversely, freely available Google Meet links can be created without cost, but manually pasting raw Meet links into chat channels introduces serious operational and security issues:
- **Link Leakage:** External parties or non-team members can enter without verification.
- **No Attendance Tracking:** There is no record of who attended which standup or sprint review.
- **Link Sprawl:** Multiple outdated links float around the team with no clear source of truth.

### 1.2 Our Solution: 6 Pre-Provisioned Bridge Slots with LRU Rotation
The platform provisions 6 persistent Google Meet bridge rooms in the database:
```sql
CREATE TABLE meeting_slots (
  id INTEGER PRIMARY KEY,
  slot_code TEXT UNIQUE NOT NULL, -- 'SLOT-01' to 'SLOT-06'
  slot_name TEXT NOT NULL,
  raw_url TEXT NOT NULL,
  last_used_at TEXT
);
```

When the Team Lead schedules a new meeting or sync call, the backend automatically assigns the **Least-Recently-Used (LRU)** slot:
```sql
SELECT * FROM meeting_slots ORDER BY last_used_at ASC NULLS FIRST LIMIT 1;
```
This ensures zero overlapping usage between consecutive meetings without creating dozens of disposable links or paying SaaS subscriptions.

---

## 2. Masked Gateway & Attendance Verification

### 2.1 The Masked Redirect Pipeline
Raw Google Meet URLs are **never exposed in HTML or public API endpoints**. All join links are presented as internal gateway endpoints:
`http://localhost:3030/api/meetings/join/:id`

```
[User Clicks "Join Google Meet ↗"]
           │
           ▼  GET /api/meetings/join/:id
   +---------------+
   | Auth Check    | ──> Is caller an authenticated team member? (Checks session cookie)
   +---------------+
           │
           ▼
   +---------------+
   | Audience Gate | ──> Is user in target_audience? (Host, ALL, BACKEND, FRONTEND, or list)
   +---------------+
           │
           ▼
   1. Log attendance in audit trail: [User ID] joined [Meeting Title] at [Timestamp]
   2. Update meeting slot last_used_at timestamp
   3. Issue HTTP 302 Redirect directly to the provisioned Google Meet room in companion tab
```

### 2.2 Security and Audit Integrity
When a member clicks to enter the room:
1. Unauthorized visitors or users not on the meeting guest list are rejected with `HTTP 403 Forbidden` and a `MEETING_JOIN_DENIED` entry is recorded in the security audit ledger.
2. Authorized members trigger a verified `MEETING_JOINED` audit event logging their name, handle, slot code, and timestamp before the HTTP 302 redirect sends their browser into the room.

---

## 3. Sidebar State Indicator Hues

The sidebar navigation item dynamically communicates real-time room status across both expanded and collapsed viewports:

| Meeting State | Expanded Sidebar Pill | Collapsed Sidebar (Mini-Icon) | Meaning |
|---|---|---|---|
| **Live Sync Call in Progress** | Green active pill (`status-live.active`) with pulsing green dot | Clean 44px green circular ball with centered camera icon (inner dot hidden) | A live meeting is running right now. |
| **Upcoming / Scheduled Call** | Amber/Yellow active pill (`status-scheduled.active`) with solid amber dot | Clean 44px amber circular ball with centered camera icon (inner dot hidden) | A meeting is scheduled for today. Lead can launch early. |
| **Idle / Standby** | Workspace blue active pill (`status-idle.active`) with slate gray dot | Clean 44px blue circular ball with centered camera icon | Room is standby/ready. Single call invariant enforced. |

### Elimination of Collapsed Mode Artifacts
In collapsed sidebar mode, displaying an inner dot beside an icon within a 44px circular ball causes visual misalignment and clutter. Frontier AI cleans this by applying `display: none !important;` to `.room-status-dot` within `.workspace-sidebar.collapsed`. Instead, the 44px circular ball itself adopts the state color directly (amber circle with centered amber camera when scheduled; green circle with centered green camera when live; blue circle when idle).

---

## 4. Video Transport Architecture & The In-Browser Question (Path A vs Path B)

### 4.1 The `X-Frame-Options` Restriction
A common technical question is: *"Why can't Google Meet be rendered inside an `<iframe>` directly on the webpage?"*

Google Meet explicitly serves rigid HTTP security response headers:
```http
X-Frame-Options: SAMEORIGIN
Content-Security-Policy: frame-ancestors 'self' https://meet.google.com;
```
Modern web browser engines enforce this at the networking layer. **No third-party website can render `meet.google.com` inside an iframe.** Any attempt to iframe Google Meet results in an instant origin-blocking error in DevTools.

### 4.2 Would Google OAuth (Google Login) Solve This?
**No.** Google OAuth 2.0 authenticates a user's identity, but Google's cross-origin security policies remain unchanged. Even if a user logs into our site using Google OAuth, Google Meet's `X-Frame-Options: SAMEORIGIN` header still forbids third-party iframes. 

While Google OAuth would allow our backend to call Google Calendar APIs to create disposable Meet links on the fly, it adds Google Cloud Console verification friction and client secrets without solving the iframe restriction.

### 4.3 Why Path A (Pop-Out Gateway) Is the Optimal Production Pattern
Frontier AI uses **Path A (Pop-Out Companion Gateway)**:
1. **Zero Cost & Zero Maintenance:** Relies on Google's global low-latency WebRTC media servers without paying third-party video API charges or managing complex media relays.
2. **Separation of Concerns:** 
   - **Frontier AI Workspace:** Acts as the coordination cockpit — managing sprint tasks, peer tasklets, anonymous cryptographic ballots, team agendas, countdown timers, and verified audit logs.
   - **Companion Window:** Dedicated to hardware camera/microphone capture, echo cancellation, low-latency audio mixing, and high-resolution screen sharing.
3. **No Mock Confusion:** Eliminates simulated or fake client-side audio bars. When a user clicks "Join Google Meet ↗", they connect immediately to their real teammates on a verified video call.

### 4.4 Alternative for 100% In-Browser Video: Jitsi Meet (Path B)
If an organization strictly requires cameras to be rendered within the same browser tab without leaving the site, the drop-in zero-cost solution is **Jitsi Meet API (`meet.jit.si`)**:
- 100% open-source and free with no API keys or credit card requirements.
- Uses `new JitsiMeetExternalAPI("meet.jit.si", { roomName: "FrontierRoomSlot1", parentNode: container })`.
- Natively supports iframe embedding with full WebRTC audio, video, chat, and screen share controls.
