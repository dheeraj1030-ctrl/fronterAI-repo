# Frontier AI Internal Platform

## Architecture Exploration Brief for an Agentic Engineering Tool

**Document status:** Working proposal, not a finalized architecture\
**Checkpoint date:** 14 October 2026\
**Team size:** 8 members\
**Current development split:** 3 backend developers and 3 frontend
developers\
**Primary constraint:** Target ₹0 hosting and storage costs using free
tiers or existing hardware\
**Priority order:** Security \> Efficiency \> Minimalism

------------------------------------------------------------------------

## 1. Purpose

Build an internal web platform for Frontier AI to coordinate team work
and provide a collaborative software-engineering learning project.

The platform should be modular enough that individual providers or
components can be replaced as the team's needs evolve. Avoid locking the
entire application into a single vendor, but also avoid premature
microservices or distributed-system complexity.

This document is a brief for an agentic coding tool to investigate and
prototype a plausible implementation. It is not permission to deploy to
production, create paid resources, publish secrets, or make irreversible
changes.

## 2. Product scope under consideration

Potential modules:

-   Member sign-in and membership allowlist
-   Member profiles and roles
-   Dashboard and activity feed
-   Projects, tasks, assignments, deadlines, and progress
-   Deliverable submissions and links
-   Research notes and experiment records
-   Anonymous peer evaluation/voting
-   Access-request tickets for sensitive operations
-   Approval workflow and temporary privileged access
-   Audit trail for security-relevant events
-   Backup, restoration, and emergency shutdown procedures

The first prototype should be much smaller than the full product.

## 3. Decisions and preferences established so far

### User experience and frontend

-   Prefer plain HTML, CSS, and vanilla JavaScript.
-   Keep the UI minimal and professional.
-   Do not introduce a frontend framework without a clear need.
-   Frontend code is untrusted. Hiding buttons in the UI is not
    authorization.

### Identity

-   GitHub OAuth is the preferred sign-in direction.
-   Maintain an explicit allowlist of authorized Frontier AI GitHub
    identities.
-   Identify users using GitHub's stable numeric user ID, not only their
    mutable username.
-   A valid GitHub account does not automatically imply Frontier AI
    membership.
-   Use server-managed sessions or another carefully designed secure
    session arrangement.
-   Validate OAuth state and redirect URIs. Keep client secrets and
    privileged tokens server-side.

### Architecture and cost

-   Target ₹0 costs, subject to provider quotas, free-tier changes, and
    availability limitations.
-   GitHub should be used for source control, code review, issues,
    CI/CD, migrations, and documentation.
-   A private GitHub repository was considered as a possible persistent
    data store.
-   A managed PostgreSQL database such as Supabase Free was considered.
-   Cloudflare Pages + Workers + D1 was also considered as a possible
    free-tier stack.
-   The exact hosting and persistence choice is still open.
-   Provider-specific details should be isolated behind interfaces where
    this is practical.

### Governance

-   There are currently 3 backend developers and 3 frontend developers.
-   Backend developers should not automatically receive unrestricted
    production access.
-   Sensitive operations should use access-request tickets containing a
    reason, scope, risk, and requested duration.
-   Requesters must not approve their own tickets.
-   Approved privileges should be narrow, temporary, revocable, and
    expire automatically.
-   Critical changes, including changes to authorization rules or
    approval policies, should require independent review.
-   Audit events should be protected against silent alteration by the
    same person being audited.
-   Repository branch protection and pull requests are useful, but
    administrators may have bypass powers.
-   The system must explicitly account for the distinction between
    application roles and infrastructure ownership.

## 4. Core security principle

**No single person should be able to silently change the rules governing
their own privileged access.**

Application roles alone cannot guarantee this if one person controls the
repository, hosting account, deployment credentials, database
administration, and audit destination.

To reduce unilateral power, separate the following where feasible:

1.  Source-code review and merge authority.
2.  Approval authority for privileged operations.
3.  Production deployment authority and credentials.
4.  Database/application permissions.
5.  Audit-log storage and access.

A free-tier architecture can reduce risk, but cannot promise protection
against every ultimate account owner or provider administrator. The
residual trust assumptions must be documented.

## 5. The storage idea currently being explored

The team discussed using SQL-like operations while keeping durable data
in a GitHub private repository, to reduce direct hosting costs and avoid
tying the application to a particular managed database.

Possible concepts discussed:

-   Run a SQL engine in the Node.js backend or in a local/temporary
    environment.
-   Use temporary working storage for processing.
-   Export accepted changes or snapshots into a private repository.
-   Use a public repository for frontend/source code and harmless
    fixtures.
-   Use a private repository for sensitive durable records or backups.
-   Keep the persistence layer replaceable so it can later be changed to
    PostgreSQL or another database.

**This is an experimental idea, not an accepted production design.**

### Critical technical facts

-   A GitHub repository cannot itself run PostgreSQL.
-   PostgreSQL needs a running server and writable storage for its data
    directory, indexes, transactions, and recovery state.
-   SQLite also needs a writable database file while it is operating.
-   GitHub commits and the Contents API are not a transactional
    database.
-   GitHub Actions can run temporary databases for tests, but are not a
    persistent application database or continuously available API
    server.
-   Committing snapshots to GitHub can be a backup/export mechanism, but
    should not be mistaken for database durability or transaction
    coordination.
-   If two writers create updates from the same old snapshot, one update
    may overwrite the other unless writes are coordinated and conflicts
    are detected.
-   A temporary filesystem may disappear after a restart, redeploy, or
    host recycling.
-   A single-writer coordinator, version checks, idempotency, retries,
    crash recovery, and restoration testing would be required for a
    repository-backed prototype.

### Public repository warning

**Never place private application data in a public repository, even
temporarily.** Public commits can be cloned, cached, indexed, or
retained after deletion. Deleting a file later does not make its
previous contents private.

Use the public repository only for code, non-sensitive configuration,
documentation, and synthetic test fixtures. Any private data must remain
in private storage or a trusted backend until deliberately published.

### Questions the agent should investigate

1.  Can a local SQLite database be used as a disposable working engine,
    with encrypted or otherwise access-controlled snapshots exported to
    a private repository?
2.  What are the durability, concurrency, data-loss, history-retention,
    rate-limit, and recovery risks?
3.  Would a free managed PostgreSQL service be simpler and safer for the
    first prototype?
4.  Could a free serverless backend plus a managed database satisfy the
    zero-cost target with less operational complexity?
5.  Can the data layer be designed so a repository-backed experiment can
    later be replaced by PostgreSQL without rewriting business logic?
6.  What exactly is the threat model for a repository owner or hosting
    administrator who may bypass application-level controls?

The agent should compare options with evidence and recommend a small
experiment. Do not assume that the repository-backed concept is viable
merely because it is possible to write files through an API.

## 6. Candidate architectures to compare

### Option A: GitHub + Supabase Free

-   GitHub repository for code, pull requests, CI, migrations, and
    documentation.
-   GitHub Pages or another free static host for the frontend.
-   Supabase Auth for GitHub OAuth integration.
-   Supabase PostgreSQL for application records.
-   Row-level security for data access restrictions.
-   Edge Functions or a trusted backend for sensitive business logic.
-   Independent backup/export process.

Strengths: conventional relational database, integrated authentication
and APIs, less custom infrastructure.

Risks: free-tier limits and pausing behavior, cross-origin
authentication configuration, owner/admin powers, and limited free
backup guarantees.

### Option B: Cloudflare Pages + Workers + D1

-   Pages for static frontend.
-   Workers for API/business logic.
-   D1 for relational data using SQLite semantics.
-   GitHub for source control, reviews, and deployment workflows.
-   GitHub OAuth integrated through the backend.

Strengths: a cohesive serverless hosting approach and potentially fewer
separately managed services.

Risks: D1 is not PostgreSQL; runtime and SQL semantics differ;
provider-specific implementation; quotas and owner/admin trust
assumptions.

### Option C: Node.js + SQLite working store + private-repository snapshots

-   Node.js API.
-   SQLite as a temporary or locally persisted working database.
-   A single coordinated writer exports snapshots or records to a
    private repository.
-   Explicit recovery and versioning process.
-   GitHub for source control and CI.

Strengths: low direct hosting cost if a suitable existing runtime is
available; useful as an educational persistence experiment.

Risks: runtime availability, loss of local state, write conflicts,
backup correctness, API limits, Git history growth, and substantial
custom reliability work. It is not a recommended production default
until tested.

### Option D: Node.js + managed PostgreSQL

-   Node.js backend.
-   Managed PostgreSQL free tier where available.
-   GitHub for code and migrations.
-   Independent backup and governance procedures.

Strengths: conventional backend learning, transactions, relational
constraints, and clearer separation between code and live data.

Risks: free-tier limits, provider availability, credential
administration, and the need to manage deployment.

## 7. Proposed role and permission model

Roles should be mapped to explicit permissions rather than using broad
checks such as `isAdmin`.

Candidate roles:

-   `member`
-   `frontend_developer`
-   `backend_developer`
-   `reviewer`
-   `security_admin`
-   `platform_admin`

These are logical roles, not necessarily separate people. Combining
roles increases power and should be considered in the threat model.

Possible permissions include:

-   View permitted projects.
-   Manage assigned tasks.
-   Submit deliverables.
-   Create and review pull requests.
-   Raise access requests.
-   Approve access requests.
-   Deploy to production.
-   Perform production data operations.
-   Manage credentials.
-   Change security policy.
-   Suspend privileged operations.
-   Review audit events.

A developer's permanent role must be separate from temporary privileged
grants.

A temporary grant should include at least:

-   User identity
-   Ticket ID
-   Requested permission/scope
-   Approver identities
-   Approval timestamps
-   Start and expiry times
-   Revocation status
-   Relevant audit events

The backend must check authorization on every protected operation. A
frontend flag or a ticket status alone is not sufficient.

## 8. Data model candidates

The initial schema may include:

-   `members`
-   `roles`
-   `permissions`
-   `member_roles`
-   `projects`
-   `tasks`
-   `task_assignments`
-   `deliverables`
-   `access_tickets`
-   `ticket_approvals`
-   `temporary_grants`
-   `audit_events`
-   `peer_evaluation_rounds`
-   `peer_ballots`

Do not implement every table before validating the architecture. Start
with members, tasks, and a minimal access-ticket workflow.

Anonymous voting requires special care: eligibility verification and
ballot anonymity must be separated. Avoid storing a direct
voter-to-ballot mapping unless the privacy model explicitly permits it.
Document what anonymity can and cannot be guaranteed against
administrators.

## 9. Repository and collaboration model

Prefer a monorepo for the initial project:

``` text
frontier-platform/
├── apps/
│   └── web/
├── backend/
│   └── api/
├── packages/
│   ├── auth/
│   ├── tasks/
│   ├── approvals/
│   └── audit/
├── database/
│   ├── migrations/
│   └── seeds/
├── tests/
├── docs/
└── .github/
    └── workflows/
```

The structure is illustrative and may be simplified for the first
prototype.

Keep business logic independent from the persistence provider where
doing so is reasonable. Use explicit interfaces such as:

-   `AuthProvider`
-   `TaskRepository`
-   `ApprovalService`
-   `AuditLogger`
-   `StorageProvider`

Do not create abstraction layers that add complexity without a plausible
migration or testing benefit.

## 10. Prototype scope

Build only a small vertical slice first:

1.  Authenticate a GitHub account.
2.  Reject accounts outside the allowlist.
3.  Read one task record.
4.  Update the task through a backend API.
5.  Reject an unauthorized update.
6.  Detect a conflicting write.
7.  Create an access ticket.
8.  Require approval from someone other than the requester.
9.  Grant and expire a temporary permission.
10. Record the sensitive operation in an audit log.
11. Simulate a backend restart and demonstrate recovery.
12. Test the emergency shutdown behavior.

For the repository-backed experiment, add tests for concurrent writes,
interrupted commits, restoration from a snapshot, duplicate requests,
and repository API failures.

## 11. Instructions to the agentic coding tool

Work in **planning and prototype mode**.

1.  Inspect the available environment and existing repository before
    making assumptions.
2.  Present a concise architecture comparison and state the assumptions.
3.  Identify the simplest experiment that can validate or falsify the
    repository-backed persistence idea.
4.  Prefer reproducible local development and synthetic test data.
5.  Do not create paid resources or subscribe to services.
6.  Do not deploy to production, publish data, or modify a real private
    repository without explicit authorization.
7.  Never place secrets, OAuth tokens, database credentials, real member
    data, or private ballots in public files or commits.
8.  Provide `.env.example` with placeholder values, and ensure actual
    `.env` files are ignored by Git.
9.  Include automated tests for authentication, authorization,
    concurrent writes, expiry, and recovery.
10. Document limitations and failure modes instead of claiming security
    guarantees that the implementation does not provide.
11. If an architectural assumption is wrong, explain it and propose an
    alternative before building a large implementation.
12. Keep the first prototype small. Do not implement all product modules
    at once.

### Expected deliverables

-   `docs/architecture.md`
-   `docs/threat-model.md`
-   `docs/decisions.md` or short ADRs
-   `docs/prototype-plan.md`
-   Minimal working prototype
-   Automated tests
-   Local setup instructions
-   Free-tier and operational limitations
-   A clear recommendation on whether repository-backed persistence
    should be retained, limited to backups, or discarded

## 12. Decision status summary

### Directionally agreed

-   Security \> Efficiency \> Minimalism.
-   Target ₹0 cost where practical.
-   Vanilla JavaScript frontend preference.
-   GitHub OAuth as the preferred sign-in route.
-   Explicit member allowlist.
-   Temporary, approval-based privileged access.
-   Independent review for critical changes.
-   Modular code and replaceable providers.
-   GitHub for source control and collaboration.

### Not finalized

-   Supabase versus Cloudflare versus another backend/database.
-   PostgreSQL versus SQLite for the initial live database.
-   Whether private-repository snapshots should be used at all.
-   Backend hosting provider.
-   Approval thresholds and role assignments.
-   Audit-log destination and backup retention.
-   Production deployment and recovery procedures.

------------------------------------------------------------------------

**Guiding instruction:** Optimize for a secure, understandable, testable
first prototype. Preserve optionality through clean boundaries, not
through premature complexity. Treat the repository-backed SQL concept as
a hypothesis to test, not as an assumed solution.
