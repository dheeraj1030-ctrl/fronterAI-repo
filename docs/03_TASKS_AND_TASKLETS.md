# Frontier AI — Task Assignment & Peer Tasklet Engine

## 1. Dual Task Paradigm

In small collegiate and agile development teams, task management operates at two distinct levels:
1. **Formal Sprint Tasks (Lead -> Member):** Official deliverables scheduled by the Team Lead with fixed milestone deadlines and deliverable PR attachments.
2. **Informal Peer Tasklets (Member <-> Member):** Lightweight micro-requests between teammates (e.g., code reviews, testing SQLite migrations, reviewing PRs, checking schema changes).

Frontier AI explicitly separates these workflows into two purpose-built engines to avoid cluttering formal project boards with informal conversational requests.

```
+-----------------------------------------------------------------------------------------+
|                                    DUAL TASK ENGINE                                     |
+-----------------------------------------------------------------------------------------+
|                                                                                         |
|  [FORMAL SPRINT TASKS]                                    [INFORMAL PEER TASKLETS]      |
|  * Scope: Official project deliverables                   * Scope: Peer micro-tasks     |
|  * Assigned By: Team Lead only                            * Assigned By: Teammates      |
|  * Governance: Deadlines + Optimistic Concurrency Control * Governance: Member status    |
|  * Views: Kanban Board + "Assigned to Me" Checklist        * Views: "Peers" module       |
|  * States: TODO -> IN_PROGRESS -> COMPLETED               * States: PENDING -> ACCEPTED |
|                                                                     -> DONE             |
+-----------------------------------------------------------------------------------------+
```

---

## 2. Formal Sprint Tasks & Optimistic Concurrency Control (OCC)

### 2.1 Database Schema
```sql
CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  track TEXT NOT NULL,
  assignee_id INTEGER,
  status TEXT DEFAULT 'TODO',
  deadline TEXT,
  deliverable_url TEXT,
  version INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (assignee_id) REFERENCES members(id)
);
```

### 2.2 Sized Kanban Boards
To prevent the jarring visual jumping often seen in web dashboards when a card is dropped or dynamically rendered, the Kanban columns (`TO DO`, `IN PROGRESS`, `COMPLETED`) feature calibrated dimensions and clean typography:
- `min-height: 280px; max-height: 480px; padding: 2px 6px 14px 2px;`
- Comfortably fits **~2 task cards** simultaneously.
- Card descriptions (`.kanban-card-desc`) are capped with `-webkit-line-clamp: 3` and ellipsis overflow to avoid mid-line text slicing.
- When 3 or more tasks are assigned to a column, a custom vertical scrollbar appears inside that column container without shifting surrounding page elements.

### 2.3 Optimistic Concurrency Control (OCC)
In collaborative multi-user environments, race conditions can lead to the **"Lost Update"** problem where User B overwrites User A's changes without knowing they happened.

#### How OCC Works:
1. Every task row maintains an integer `version` field (initialized to `1`).
2. When the client reads the task list, it receives the current version number.
3. When updating a task (`PATCH /api/tasks/:id`), the client must send `{ status, version }`.
4. The server executes an atomic conditional update:
   ```sql
   UPDATE tasks
   SET status = ?, version = version + 1, updated_at = ?
   WHERE id = ? AND version = ?;
   ```
5. **Success (`changes === 1`):** The task is updated, version increments to `2`, and the change is broadcast.
6. **Conflict (`changes === 0`):** The version in the database is newer than what the client sent. The server rejects the write with **`HTTP 409 Conflict`** and returns both the current server version and the stale client payload.

#### The OCC Visual Conflict Modal:
When a 409 Conflict occurs, the client UI opens a side-by-side diff modal (`#modal-occ-conflict`):
- Shows **Server Current State** (e.g., `v2 - COMPLETED`)
- Shows **Your Attempted State** (e.g., `v1 - IN_PROGRESS`)
- Provides a one-click **"Reload & Sync"** button that refreshes local state without data corruption.

---

## 3. Peer Tasklets (Informal Member-to-Member Collaboration)

### 3.1 Why Tasklets Were Introduced
Regular team members cannot assign formal sprint tasks (which is restricted to the Team Lead). However, developers constantly need informal help from their peers:
- *"Can you review PR #12 for frontend CSS quirks?"*
- *"Please test the SQLite WAL mode checkpoint on your Windows setup."*
- *"Can we sync for 5 minutes before tomorrow's call?"*

Rather than losing track of these in external messaging apps, the **`Peers`** module gives every team member a dedicated micro-task pipeline.

### 3.2 Database Schema
```sql
CREATE TABLE tasklets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id INTEGER NOT NULL,
  receiver_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'PENDING',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (sender_id) REFERENCES members(id),
  FOREIGN KEY (receiver_id) REFERENCES members(id)
);
```

### 3.3 Tasklet Lifecycle & Actor Enforcement
```
[Sender Creates Tasklet] ──> Status: PENDING
                                  │
      ┌───────────────────────────┴───────────────────────────┐
      │                                                       │
[Receiver clicks "Accept"]                              [Receiver clicks "Mark Done"]
      │                                                       │
      ▼                                                       ▼
Status: ACCEPTED                                        Status: DONE
      │                                                       ▲
      └──────────────── Receiver clicks "Mark Done" ──────────┘
```

1. **Creation (`POST /api/tasklets`):**
   - Any team member can send a tasklet to any teammate.
   - Initial status: `PENDING`.
   - Receiver's sidebar badge updates with an unread count.
2. **Transition (`PATCH /api/tasklets/:id`):**
   - Only the designated recipient (or the Team Lead) can transition a tasklet to `ACCEPTED` or `DONE`.
   - If an unauthorized member attempts to update another peer's tasklet, the server rejects it with `403 Forbidden`.
3. **Tabbed Organization:**
   - **Received Tab:** Displays incoming requests with action buttons (`[Accept]`, `[Mark Done]`).
   - **Sent Tab:** Displays outbound requests sent to teammates to track who is working on what.
4. **Directory Integration:**
   - The Team Directory in the Peers view displays each teammate with a **`+ Send Tasklet`** button that pre-selects the recipient in the dialog modal.
