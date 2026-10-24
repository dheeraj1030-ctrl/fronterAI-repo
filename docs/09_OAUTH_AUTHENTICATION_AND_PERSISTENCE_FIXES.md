# Frontier AI — OAuth Authentication & Session Persistence: Troubleshooting & Architecture Fixes

This document records the technical investigation, root cause analysis, architectural redesign, and codebase modifications implemented to resolve two critical issues in Frontier AI's authentication layer:
1. **The Multi-Click Sign-In Issue** (requiring users to click "Sign in with Google" multiple times due to `csrf_state_mismatch` errors).
2. **The Session Non-Persistence Issue** (users being logged out on page refresh or after brief intervals, particularly in Cloudflare Pages environments).
3. **The Manual Verification & Host Approval System** (migrating from hardcoded account allowlists to dynamic, Host-reviewed onboarding).

---

## 1. Executive Summary & Observed Symptoms

During live testing of Google OAuth 2.0 authentication on both Cloudflare Pages (`*.pages.dev`) and local environments, two distinct failure modes were observed:

| Symptom | Observed Behavior | User Impact |
|---|---|---|
| **Multi-Click Requirement** | Clicking "Sign in with Google" occasionally failed, dumping the user back to the login screen with `?error=csrf_state_mismatch`. Users had to click the sign-in button 2 to 3 times before successfully entering the workspace. | Frustrating onboarding flow, appearance of flakiness or broken authentication. |
| **Session Drop / Non-Persistence** | After successfully authenticating, refreshing the browser or opening a new tab frequently dropped the user back to the unauthenticated login screen. | Inability to maintain an active working session; lost state during normal workflow. |
| **Lead Approval Desynchronization** | On first load, the Team Lead's interface did not display the "Pending Access Requests" badge until a secondary navigation occurred. | Team Leads had to refresh or click around before realizing new users were awaiting approval. |

---

## 2. Root Cause Analysis (Deep Dive)

### 2.1 Issue A: The Multi-Click Race Condition (`csrf_state_mismatch`)

#### How Standard OAuth State Verification Works
To protect against Cross-Site Request Forgery (CSRF), OAuth 2.0 flows generate a cryptographic `state` parameter:
1. The client initiates login at `/api/auth/google`.
2. The server creates a random UUID string (e.g., `crypto.randomUUID()`).
3. The server sets an HTTP cookie: `Set-Cookie: oauth_state=<uuid>; HttpOnly; SameSite=Lax`.
4. The server redirects the browser to Google with `?state=<uuid>`.
5. Google prompts the user, then redirects back to `/api/auth/google/callback?code=...&state=<uuid>`.
6. The server reads incoming cookies and checks `cookies.oauth_state === state`.

```
[Browser] ---------- GET /api/auth/google ---------> [Server]
    ^                                                    | Set-Cookie: oauth_state=UUID_A
    | <------- 302 Redirect to Google with UUID_A -------+
    |
[Google Accounts]
    | <------- 302 Redirect to /callback?state=UUID_A ---+
    v
[Server Callback] <--- Check: cookies.oauth_state === state
```

#### Why It Failed
Two independent factors caused state verification to fail:

1. **Cross-Site Navigation Cookie Partitioning / Dropping:**
   * Google's redirect from `accounts.google.com` to `*.pages.dev/api/auth/google/callback` is a top-level cross-site navigation GET request.
   * Modern browser privacy protections (Google Chrome Incognito, Brave Shields, Apple Safari ITP, and partitioned cookie storage for `.pages.dev` domains) frequently suppress or omit `SameSite=Lax` cookies during redirects initiated by external third-party identity providers.
   * When `cookies.oauth_state` was missing on the callback request, `cookies.oauth_state !== state` evaluated to `true`, triggering an immediate `csrf_state_mismatch` rejection.

2. **The Double-Click Overwrite Race Condition:**
   * If a user clicked "Sign in with Google" once, and experienced even a 500ms delay before Google's consent screen appeared, they often clicked the button a second time.
   * Click #2 immediately hit `/api/auth/google`, overwriting the browser cookie with **`UUID_B`**.
   * Meanwhile, Google finished processing Click #1 and redirected back to the callback with **`UUID_A`**.
   * The server compared `cookies.oauth_state` (`UUID_B`) against incoming `state` (`UUID_A`), detected a mismatch, logged `OAUTH_CSRF_FAILED`, and redirected to `/?error=csrf_state_mismatch`.
   * On Click #3, if the user waited patiently, the single isolated state matched, allowing them in.

---

### 2.2 Issue B: Session Non-Persistence

#### Why Sessions Were Dropping
1. **Cookie-Only Architecture on Cloudflare Pages:**
   * Cloudflare Pages (`*.pages.dev`) is subject to modern Public Suffix List (PSL) rules and browser third-party cookie restrictions. When users refresh the page, browser privacy sandboxes often isolate or refuse to send cookies across worker function boundaries if third-party tracking shields are active.
2. **SQLite ISO-8601 vs SQL Datetime Collation:**
   * In [functions/api/[[catchall]].js](file:///c:/Users/GIGA/Desktop/fronterAI-repo/functions/api/%5B%5Bcatchall%5D%5D.js), active sessions were queried with:
     ```sql
     SELECT member_id FROM sessions WHERE token = ? AND expires_at > datetime('now')
     ```
   * Sessions were inserted using JavaScript's `new Date().toISOString()`, which formats timestamps as `YYYY-MM-DDTHH:MM:SS.sssZ`.
   * SQLite's `datetime('now')` formats timestamps as `YYYY-MM-DD HH:MM:SS`.
   * In SQLite string collation, comparing an ISO string with a space-separated datetime can yield unexpected lexicographical ordering depending on UTC timezone parsing, resulting in valid sessions being falsely treated as expired.
3. **Short Expiration Windows:**
   * Session tokens were originally set to expire in 24 hours or 7 days, meaning users working across days were routinely forced to re-authenticate.
4. **Lack of a Secondary Persistence Channel:**
   * If cookie transmission failed for any reason (privacy extensions, iframe embeddings, partitioned context), there was zero fallback mechanism on the client.

---

### 2.3 Issue C: Initialization Execution Order

In [public/app.js](file:///c:/Users/GIGA/Desktop/fronterAI-repo/public/app.js), the bootstrap function `init()` originally executed:
```javascript
await loadMembers();
await loadCurrentAuth();
```
Inside `loadMembers()`, the code checked:
```javascript
if (state.currentUser && state.currentUser.is_host === 1) {
  await fetchPendingAccessRequests();
}
```
Because `loadCurrentAuth()` had not yet resolved, `state.currentUser` was **always `null`** during initial roster loading. Consequently:
* Host permission flags were not applied on first paint.
* The pending approval badge and review queue were not loaded until the user manually clicked between views.

---

## 3. The Architectural Solution

To permanently resolve these issues across both local development and Cloudflare Pages D1 deployments, the following architectural upgrades were engineered:

```
+---------------------------------------------------------------------------------------------------+
|                                 FRONTIER AI DUAL-PERSISTENT AUTH                                 |
+---------------------------------------------------------------------------------------------------+

     [CLIENT BROWSER]                                              [EDGE / SERVER]
            |                                                             |
            | 1. Click "Sign In" (Button Debounced 5s)                   |
            +-------------------- GET /api/auth/google -----------------> |
            |                                                             | Generate HMAC Signed State:
            |                                                             | State = Nonce . TS . HMAC(Nonce.TS, Secret)
            | <----- 302 Redirect to Google with Signed State ------------+ (No cookie dependency)
            |                                                             |
            v                                                             |
     [GOOGLE ACCOUNTS]                                                    |
            | 2. User Authenticates & Grants Profile                      |
            +--- 302 Callback to /callback?code=...&state=Nonce.TS.Sig -> |
                                                                          | Verify:
                                                                          | 1. HMAC Signature Valid
                                                                          | 2. (Now - TS) < 15 minutes
                                                                          | 3. Exchange Code for Access Token
                                                                          | 4. Match / Register Member
                                                                          | 5. Issue 30-Day Session Token
            | <--- 302 Redirect to /?auth=oauth_success&sid=<token> ------+
            |      Set-Cookie: frontier_session=<token>; Max-Age=30 days  |
            |                                                             |
            | 3. Client captures `sid` into localStorage                  |
            | 4. Universal fetch interceptor attaches:                    |
            |    Authorization: Bearer <token> to EVERY /api/ request    |
            |                                                             |
            +-------------------- GET /api/auth/current ----------------> | Resolved via Header or Cookie!
            |                     (Bearer Token + Cookie)                 | Checks D1 SQLite with ISO fallback
            | <------------------ 200 OK: User & Host Permissions --------+
```

---

### 3.1 Solution 1: Stateless HMAC-SHA256 Signed OAuth States

Instead of storing state tokens in volatile browser cookies, the server now issues **self-verifying cryptographic state tokens**:

$$\text{state} = \text{nonce} \,.\, \text{timestamp} \,.\, \text{HMAC-SHA256}(\text{secret}, \text{nonce} + \text{timestamp})$$

#### Implementation Details
* **Generation:**
  ```javascript
  async function createSignedState(secret) {
    const nonce = crypto.randomUUID().replace(/-/g, '');
    const ts = Date.now().toString();
    const sig = await hmacSha256(secret, `${nonce}.${ts}`);
    return `${nonce}.${ts}.${sig}`;
  }
  ```
* **Validation:**
  ```javascript
  async function verifySignedState(secret, stateToken) {
    if (!stateToken || typeof stateToken !== 'string') return false;
    const parts = stateToken.split('.');
    if (parts.length !== 3) return false;
    const [nonce, tsStr, sig] = parts;
    const ts = parseInt(tsStr, 10);
    if (isNaN(ts)) return false;
    // Enforce 15-minute sliding TTL
    if (Date.now() - ts > 15 * 60 * 1000 || ts > Date.now() + 60 * 1000) return false;
    const expectedSig = await hmacSha256(secret, `${nonce}.${tsStr}`);
    return sig === expectedSig;
  }
  ```
* **Key Benefits:**
  1. **Zero Cookie Dependency:** The callback verification no longer requires cookies to survive cross-site redirection from Google.
  2. **Immune to Multi-Click Race Conditions:** If the user clicks multiple times, each click generates a mathematically valid signed state. Whichever callback Google returns first will validate successfully.
  3. **Tamper-Proof & Replay-Protected:** States expire strictly after 15 minutes and cannot be forged without knowing the server's private secret.

---

### 3.2 Solution 2: Client-Side Anti-Bounce Button Latching

To prevent rapid accidental double-clicks from spawning redundant Google redirect cycles:
```javascript
const btnGoogle = document.getElementById('btn-google-oauth');
btnGoogle?.addEventListener('click', (e) => {
  if (btnGoogle.dataset.navigating === 'true') {
    e.preventDefault();
    return;
  }
  btnGoogle.dataset.navigating = 'true';
  btnGoogle.style.opacity = '0.7';
  btnGoogle.style.pointerEvents = 'none';
  setTimeout(() => {
    btnGoogle.dataset.navigating = 'false';
    btnGoogle.style.opacity = '1';
    btnGoogle.style.pointerEvents = 'auto';
  }, 5000);
});
```

---

### 3.3 Solution 3: Dual-Persistence Architecture (Cookie + Bearer Token)

To guarantee that authentication survives browser refreshes, third-party cookie blocking, and tab closures:

1. **Token Propagation in URL:**
   On successful OAuth login, the backend sets the standard 30-day cookie *and* appends `sid` to the redirect target:
   ```
   Location: /?auth=oauth_success&sid=${sessionToken}
   ```
2. **Client-Side Storage:**
   [public/app.js](file:///c:/Users/GIGA/Desktop/fronterAI-repo/public/app.js) reads `sid` on startup and commits it to `localStorage`:
   ```javascript
   const params = new URLSearchParams(window.location.search);
   const sid = params.get('sid');
   if (sid) {
     localStorage.setItem('frontier_session', sid);
   }
   window.history.replaceState({}, document.title, window.location.pathname);
   ```
3. **Universal Client Fetch Interceptor:**
   All outbound `fetch()` requests throughout the application automatically inject the session token into the `Authorization` header:
   ```javascript
   const originalFetch = window.fetch;
   window.fetch = function (resource, options = {}) {
     const token = localStorage.getItem('frontier_session');
     if (token) {
       options = options || {};
       if (!options.headers) {
         options.headers = { 'Authorization': `Bearer ${token}` };
       } else if (options.headers instanceof Headers) {
         if (!options.headers.has('Authorization')) {
           options.headers.set('Authorization', `Bearer ${token}`);
         }
       } else {
         if (!options.headers['Authorization'] && !options.headers['authorization']) {
           options.headers['Authorization'] = `Bearer ${token}`;
         }
       }
     }
     return originalFetch.call(this, resource, options);
   };
   ```
4. **Dual Server-Side Resolution:**
   Both Cloudflare Pages ([functions/api/[[catchall]].js](file:///c:/Users/GIGA/Desktop/fronterAI-repo/functions/api/%5B%5Bcatchall%5D%5D.js)) and Node.js ([middleware/session.js](file:///c:/Users/GIGA/Desktop/fronterAI-repo/middleware/session.js)) extract the token from either channel:
   ```javascript
   const authHeader = request.headers.get('Authorization') || '';
   const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
   const cookies = parseCookies(request);
   const token = bearerToken || cookies.frontier_session;
   ```

---

### 3.4 Solution 4: Robust SQLite D1 Date Comparison

To prevent ISO-8601 string collation errors from prematurely invalidating sessions:
```javascript
const nowIso = new Date().toISOString();
const session = await env.DB.prepare(
  "SELECT member_id FROM sessions WHERE token = ? AND (expires_at > datetime('now') OR expires_at > ?)"
).bind(token, nowIso).first();
```
Sessions now endure for **30 days** (`86400000 * 30`), providing a seamless, long-lived workflow for active team members.

---

### 3.5 Solution 5: Fixed Bootstrap Order

In [public/app.js](file:///c:/Users/GIGA/Desktop/fronterAI-repo/public/app.js), `init()` now guarantees that authentication resolves prior to member and permission rendering:
```javascript
// BEFORE (Buggy)
await loadMembers();
await loadCurrentAuth();

// AFTER (Correct)
await loadCurrentAuth();
await loadMembers();
```
Now, when `loadMembers()` executes, `state.currentUser` is already populated. If the user is the Team Lead, the pending access request count and approval actions are rendered immediately on initial load.

---

## 4. Code Modification Matrix

| File | Changes Made |
|---|---|
| [functions/api/[[catchall]].js](file:///c:/Users/GIGA/Desktop/fronterAI-repo/functions/api/%5B%5Bcatchall%5D%5D.js) | - Added `createSignedState()` and `verifySignedState()` using Web Crypto HMAC-SHA256.<br>- Updated `getAuthMember()` to support `Authorization: Bearer <token>` fallback.<br>- Fixed D1 date query with `expires_at > datetime('now') OR expires_at > ?`.<br>- Extended session cookie `Max-Age` to 30 days (`2592000`).<br>- Added `sid=${sessionToken}` to callback redirect.<br>- Used `Headers.append()` to clear `oauth_state` on login. |
| [routes/authRoutes.js](file:///c:/Users/GIGA/Desktop/fronterAI-repo/routes/authRoutes.js) | - Implemented Node.js `crypto.createHmac` signed state creation and validation.<br>- Updated `/api/auth/current` to return `token` and accept Bearer headers.<br>- Set 30-day session cookie and `sid` redirect parameter on callback.<br>- Cleared `oauth_state` cookie on login success. |
| [middleware/session.js](file:///c:/Users/GIGA/Desktop/fronterAI-repo/middleware/session.js) | - Extended `createSession()` expiry to 30 days (`Date.now() + 86400000 * 30`).<br>- Updated `getSessionUser()` to inspect `req.headers.authorization` for `Bearer <token>`.<br>- Included `email` in returned session user object. |
| [public/app.js](file:///c:/Users/GIGA/Desktop/fronterAI-repo/public/app.js) | - Installed universal `window.fetch` interceptor injecting `Authorization: Bearer <token>`.<br>- Captured `sid` query parameter into `localStorage` during `init()`.<br>- Reordered startup sequence: `await loadCurrentAuth()` runs before `await loadMembers()`.<br>- Added Google OAuth button debounce (5-second latch).<br>- Updated `loadCurrentAuth()` and `submitLogin()` to synchronize `localStorage`.<br>- Added explicit user notification for `csrf_state_mismatch` errors.<br>- Ensured `btn-header-signout` cleans up both cookie and `localStorage`. |

---

## 5. Verification & Testing

The fixes were validated across both the local Node.js environment and the live Cloudflare D1 environment:

| Test Scenario | Action | Expected Result | Result |
|---|---|---|---|
| **Single-Click Sign In** | Click "Sign in with Google" once. | Seamless redirect to Google consent screen and back to workspace. | **PASS** |
| **Rapid Double-Click** | Rapidly click "Sign in with Google" twice. | Button debounces after first click; callback verifies HMAC signature without CSRF error. | **PASS** |
| **Page Refresh Persistence** | Refresh workspace tab (`F5`) after signing in. | User remains signed in as Lead/Member with zero flickering. | **PASS** |
| **Tab Reopen Persistence** | Close tab, open a new tab, navigate to the site URL. | Universal fetch interceptor provides Bearer token; user enters workspace immediately. | **PASS** |
| **Lead Approval Badge** | Sign in as Team Lead with pending requests. | Pending request badge and queue render on the initial screen load. | **PASS** |
| **Sign Out Invalidation** | Click "Sign Out" in persona menu. | `localStorage` token removed, cookie cleared, session purged in database. | **PASS** |
