# Frontier AI — Internal Engineering Platform

A full-stack, internal collaborative platform for Frontier AI designed around a Google Workspace aesthetic with spacious, segmented views and visual workflows.

---

## Visual and Workspace Design

- Spacious Segmented Layout: Top navigation bar with global search (Ctrl + K), left collapsible navigation rail with notification badges, and a segmented workspace canvas.
- Google Workspace Dark Theme: Dark surfaces (#131314 canvas, #1e1f20 cards, #28292a elevation) paired with Material design accents (Blue #a8c7fa, Green #6dd58c, Amber #fdd663, Red #f2b8b5).
- Clean Sans-Serif Typography: Clean typography (Google Sans, Inter, system-ui) with tabular numbers and monospace for cryptographic hashes and versions.
- Visual Status Workflows: Metric cards, progress meters, segmented Kanban boards, cryptographic verification steppers, and side-by-side concurrency diffs.

---

## Accessing the Platform

The server is accessible at:
[http://localhost:3030](http://localhost:3030)

To run or restart manually:
```bash
npm start
# Or for development with automatic restart:
npm run dev
```

---

## Segmented Architecture and Workspaces

### 1. Authentication and Membership Allowlist
- Membership Verification: Enforces authentication against the 8 allowlisted members using immutable numeric GitHub IDs.
- Access Control: Rejects unknown accounts (HTTP 403 Forbidden) and logs tamper-evident security audit trails.
- Quick-Switch Identity Selectors: Fast login buttons for Team Lead (Alice Vance) and Team Members (Bob Ross, etc.) for testing in development.

### 2. Personal Workspace vs. Team Workspace
- Personal Workspace (Default for Team Members):
  - Displays personal completion rate progress gauge.
  - Lists tasks assigned specifically to the logged-in member.
  - Allows updating task status (Todo -> In Progress -> Completed) and submitting deliverable links and notes.
  - Displays personal deadlines and upcoming team meetings with direct join links.
  - Displays personal voting status (Claimed Token vs. Cast).
- Team Workspace:
  - Sprint overview: Overall completion gauge (Backend vs. Frontend tracks).
  - Master team calendar displaying deliverables, syncs, and deadlines.
  - Team directory showing all 8 members and active workload.

### 3. Role-Based Authorization (Team Lead vs. Team Member)
- Team Lead (Alice Vance):
  - Capability to assign tasks to team members with explicit deadlines.
  - Permission to schedule calendar events and update meeting links.
  - Administrative control to initiate and close anonymous peer evaluation voting sessions.
  - Access to administrative tools: Two-person rule governance approvals, security audit logs, and disaster recovery snapshots.
- Team Members:
  - Default view on personal workspace.
  - Restricted from creating tasks or scheduling calendar items (enforced server-side with 403 Forbidden).
  - Administrative navigation tabs (Governance, Audit, and Recovery) are read-only or restricted.

### 4. Master Calendar and Meeting Integration
- Deadlines and Syncs: Structured calendar items categorized by event type (Meeting, Deadline, Sprint Sync).
- Meeting Redirection: Pre-configured meeting slots and Google Meet links accessible directly from personal and global dashboards.

### 5. Anonymous Peer Performance Voting (Blind HMAC Token Protocol)
- Peer evaluation sessions to recognize sprint contributions.
- Phase 1 (Eligibility Claim): Member requests a ballot token. The system records eligibility on the ledger and issues an HMAC blind token detached from the member ID.
- Phase 2 (Anonymous Ballot Cast): Member submits their ballot with the blind token. The ballot is recorded with zero linkage to the voter identity.
- Re-use Prevention: Token hashes are recorded to prevent double voting.
- Batch Reveal: Results are sealed until all members vote or the Team Lead closes the session.

### 6. Two-Person Rule Governance Pipeline
- Core Security Rule: No developer can unilaterally grant themselves privileged production access.
- Pipeline Visualization: Displays requester, target scope, and required peer approver.
- Self-Approval Prevention: Requesters cannot approve their own tickets.
- Ephemeral Grant: Approved requests issue temporary access tokens with automatic expiration.

### 7. Security Audit Log
- Searchable and filterable log recording all platform operations (logins, allowlist rejections, concurrency conflicts, ballot token grants, ticket approvals).
- Real-time search filter by actor, action, or target.

### 8. Disaster Recovery Snapshots
- Operates on SQLite as the active transactional engine with periodic sanitized JSON exports to backups/ suitable for repository commit.
- On-demand backup generation for disaster recovery drills.

---

## Repository Structure

```
FrontierAI/
├── server.js                        # Zero-dependency Node.js HTTP server and REST API
├── db.js                            # SQLite database schema, seeds, and audit logger (node:sqlite)
├── auth.js                          # Cryptographic blind ballot token generator and HMAC verifier
├── test_prototype.js                # Automated verification test suite
├── package.json                     # Project manifest (ES Modules)
├── frontier.db                      # Local SQLite database file
├── backups/                         # Sanitized JSON snapshots exported for backup
├── frontier_ai_architecture_checkpoint.md  # Architectural reference document
└── public/
    ├── index.html                   # Semantic HTML layout
    ├── styles.css                   # Workspace design system (dark theme, responsive layout)
    └── app.js                       # Vanilla ES Module client with reactive state management
```
