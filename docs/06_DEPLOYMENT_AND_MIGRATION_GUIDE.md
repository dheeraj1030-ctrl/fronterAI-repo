# Frontier AI — Deployment & Cloudflare Migration Guide

## 1. Deployment Overview

Frontier AI is deliberately designed with a dual-target architecture:
1. **Localhost Prototype (Current):** Standalone Node.js standard library HTTP server + local SQLite (`frontier.db`), requiring zero setup or cloud accounts.
2. **Production Edge Cloud (Target):** Cloudflare Pages (Frontend) + Cloudflare Workers (Backend) + Cloudflare D1 (Serverless Distributed SQLite), operating 100% within Cloudflare's permanent **₹0 free tier**.

```
+-----------------------------------+        +-----------------------------------+
|       DEVELOPMENT PROTOTYPE       |        |        TARGET PRODUCTION          |
|                                   |        |                                   |
|   Node.js Server (`server.js`)    |  ───>  |   Cloudflare Workers (Edge API)   |
|   Local SQLite (`frontier.db`)    |  ───>  |   Cloudflare D1 Database (Edge DB)|
|   Vanilla Static (`public/`)      |  ───>  |   Cloudflare Pages (Global CDN)   |
|   `localhost:3030`                |  ───>  |   `frontier-ai.pages.dev`         |
+-----------------------------------+        +-----------------------------------+
```

---

## 2. Cloudflare Free Tier Economics (₹0 Forever)

| Resource | Cloudflare Free Tier Allowance | Frontier AI Team of 8 Usage |
|---|---|---|
| **Cloudflare Pages** | Unlimited static requests, unlimited bandwidth | ~5,000 requests / month |
| **Cloudflare Workers** | 100,000 requests / day free | ~500 to 2,000 requests / day |
| **Cloudflare D1** | 5,000,000 row reads / day free; 100,000 row writes / day free | ~2,000 reads / day; ~100 writes / day |
| **Storage** | 5 GB D1 database storage free | ~1.5 MB for entire year |
| **Total Monthly Cost** | **₹0.00** | **₹0.00** |

---

## 3. Step-by-Step Migration Guide

### Step 1: Initialize Cloudflare Wrangler CLI
```bash
# Install Cloudflare Wrangler globally or locally
npm install -g wrangler

# Authenticate with your free Cloudflare account
wrangler login
```

### Step 2: Provision Cloudflare D1 Database
```bash
# Create the production D1 database
wrangler d1 create frontier-production-db
```
Wrangler will output your database configuration snippet:
```toml
# Add to wrangler.toml:
[[d1_databases]]
binding = "DB"
database_name = "frontier-production-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

### Step 3: Run Database Migrations
Because Frontier AI uses standard SQLite SQL without proprietary extensions or ORMs, the exact schema in `db.js` runs directly on Cloudflare D1:

```bash
# Apply schema to remote D1 instance
wrangler d1 execute frontier-production-db --file=./schema.sql
```

*(You can export the current schema cleanly using: `sqlite3 frontier.db .schema > schema.sql`)*

### Step 4: Configure Production Environment Variables
Set your production secrets in Cloudflare Workers using Wrangler:

```bash
# 1. GitHub OAuth 2.0 Credentials (registered in GitHub Developer Settings)
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET

# 2. Cryptographic Ballot Secret (32+ character random hex string)
wrangler secret put VOTING_SECRET

# 3. Session Signing Secret
wrangler secret put SESSION_SECRET

# 4. Strict Production Lockdown
wrangler secret put NODE_ENV
# Enter: production
```

### Step 5: Deploy Frontend to Cloudflare Pages
```bash
# Deploy static assets in public/ directly to Cloudflare Pages
wrangler pages deploy ./public --project-name=frontier-ai
```

---

## 4. Production Security Hardening

When deploying to production (`NODE_ENV=production`), Frontier AI automatically enforces the following security guards:

1. **Simulation Endpoints Disabled (`HTTP 404`):**
   - Development routes such as `/api/auth/github/simulate` and `/api/auth/login-as` return `404 Not Found`.
   - The UI hides one-click demo pills and only displays the verified GitHub OAuth sign-in flow.
2. **Cryptographic Key Enforcement:**
   - The server will refuse to start if `VOTING_SECRET` or `SESSION_SECRET` is unset, preventing insecure default keys.
3. **Strict Allowlist Rejections:**
   - Any GitHub account not matching one of the 8 numeric IDs in the `members` database receives an instant `403 Forbidden` and is logged in the audit ledger.
4. **HttpOnly & Secure Cookies:**
   - Session cookies are set with `HttpOnly; SameSite=Lax; Secure` flags, preventing cross-site scripting (XSS) extraction.

---

## 5. Ongoing Maintenance & Backup Strategy

### On-Demand JSON Git Backups
- The Team Lead can navigate to **Settings & Logs > Database Snapshot** and click **"Generate Snapshot"**.
- The server generates a sanitized JSON file containing all database tables.
- This snapshot can be committed directly to the private GitHub repository, giving the team free, versioned, decentralized backups with zero external storage costs.
