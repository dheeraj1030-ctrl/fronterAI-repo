# Frontier AI — Cloudflare Pages & D1 Database Complete Hosting Guide

This guide walks you step-by-step through hosting **Frontier AI** on Cloudflare for **₹0 forever**, with zero server management, automatic SSL, global CDN distribution, and serverless SQLite.

---

## 1. Cloudflare Free Tier Breakdown (₹0 Forever)

| Component | Cloudflare Service | Free Tier Limit | Frontier AI Usage | Cost |
|---|---|---|---|---|
| **Frontend** | Cloudflare Pages | **Unlimited** static requests & bandwidth | ~10k req / mo | **₹0** |
| **Edge API** | Cloudflare Pages Functions / Workers | **100,000** requests / day | ~500–2k req / day | **₹0** |
| **Database** | Cloudflare D1 (Serverless SQLite) | **5,000,000** reads / day<br>**100,000** writes / day | ~3,000 reads / day<br>~200 writes / day | **₹0** |
| **Storage** | Cloudflare D1 Storage | **5 GB** database storage | ~2 MB | **₹0** |
| **Domain & SSL** | Cloudflare DNS (`*.pages.dev`) | **Unlimited** free subdomains + auto SSL | 1 domain | **₹0** |

*No credit card is required to sign up or deploy.*

---

## 2. Choosing Your Deployment Path

You have two simple ways to host this:

- **Method A: Cloudflare Dashboard (Browser UI — 100% No-CLI)**  
  Best if you prefer using the web browser and connecting directly to your GitHub repository.
- **Method B: Wrangler CLI (Terminal)**  
  Best if you prefer running 3 commands in your terminal.

---

## 3. Method A: Browser Dashboard Deployment (Zero Terminal)

### Step 1: Push Code to GitHub
Ensure your latest code and `schema.sql` are pushed to your GitHub repository:
```bash
git add .
git commit -m "Add Cloudflare D1 schema and wrangler config"
git push origin modular-overhaul-and-aichat-addition
```

### Step 2: Create Free D1 Database in Cloudflare Dashboard
1. Log in to [dash.cloudflare.com](https://dash.cloudflare.com).
2. In the left navigation sidebar, click **Storage & Databases** → **D1 SQL Database**.
3. Click **Create Database**.
4. Set **Database Name**: `frontier-production-db`.
5. Select a region close to your team (e.g., `Asia Pacific (APAC)` or `Automatic`).
6. Click **Create**.
7. In the database view, click the **Console** tab.
8. Open [`schema.sql`](file:///c:/Users/GIGA/Desktop/fronterAI-repo/schema.sql) from this repository, copy its full content, paste it into the D1 SQL Console, and click **Execute**.
   - *All 16 tables (`members`, `tasks`, `meeting_slots`, `calendar_events`, `voting_*`, `sessions`, `tasklets`, `ai_*`, `member_memories`, `audit_events`) and initial seed data are instantly created!*

### Step 3: Deploy Frontend & Functions via Cloudflare Pages
1. In the left navigation sidebar, click **Compute (Workers & Pages)** → **Pages** (or **Overview**).
2. Click **Create Application** → **Pages** → **Connect to Git**.
3. Select your GitHub account and choose the repository (`potatobun321/fronterAI-repo`).
4. Configure Build Settings:
   - **Project Name:** `frontier-ai` (or your preferred name)
   - **Production Branch:** `modular-overhaul-and-aichat-addition` (or `main`)
   - **Framework Preset:** `None`
   - **Build command:** *(Leave empty)*
   - **Build output directory:** `public`
5. Click **Save and Deploy**. Cloudflare will build and give you a live URL: `https://frontier-ai.pages.dev`.

### Step 4: Bind D1 Database to your Pages Project
1. In your Cloudflare Pages project, go to **Settings** → **Functions** (or **Bindings**).
2. Scroll to **D1 Database Bindings** and click **Add Binding**.
   - **Variable name:** `DB` *(Must be uppercase `DB`)*
   - **D1 Database:** Select `frontier-production-db`
3. Click **Save**.

### Step 5: Add Production Environment Variables
In **Settings** → **Environment Variables**, add the following production variables:

| Variable Name | Value | Secret? |
|---|---|---|
| `NODE_ENV` | `production` | No |
| `GITHUB_CLIENT_ID` | Your GitHub OAuth Client ID | No |
| `GITHUB_CLIENT_SECRET` | Your GitHub OAuth Secret | **Yes (Encrypt)** |
| `VOTING_SECRET` | 32+ character random hex string for blind ballot HMAC | **Yes (Encrypt)** |
| `SESSION_SECRET` | 32+ character random hex string | **Yes (Encrypt)** |
| `GEMINI_API_KEY` | *(Optional)* Your Google Gemini API Key | **Yes (Encrypt)** |
| `GROQ_API_KEY` | *(Optional)* Your Groq API Key | **Yes (Encrypt)** |

---

## 4. Method B: Wrangler CLI Deployment (Terminal Speedrun)

### Step 1: Login to Cloudflare via Terminal
```bash
npx wrangler login
```
*(This will open your browser to authorize Wrangler with one click).*

### Step 2: Create D1 Database
```bash
npx wrangler d1 create frontier-production-db
```
Wrangler will output:
```toml
[[d1_databases]]
binding = "DB"
database_name = "frontier-production-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```
Copy that `database_id` and paste it into [`wrangler.toml`](file:///c:/Users/GIGA/Desktop/fronterAI-repo/wrangler.toml).

### Step 3: Run the Schema Migration on D1
Run the prepared [`schema.sql`](file:///c:/Users/GIGA/Desktop/fronterAI-repo/schema.sql) file directly against your remote D1 database:
```bash
npx wrangler d1 execute frontier-production-db --remote --file=./schema.sql
```
You can verify the tables anytime:
```bash
npx wrangler d1 execute frontier-production-db --remote --command="SELECT name FROM sqlite_master WHERE type='table';"
```

### Step 4: Deploy Frontend to Cloudflare Pages
```bash
npx wrangler pages deploy ./public --project-name=frontier-ai
```

### Step 5: Set Production Secrets
```bash
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put VOTING_SECRET
npx wrangler secret put SESSION_SECRET
npx wrangler secret put GEMINI_API_KEY
```

---

## 5. GitHub OAuth 2.0 Configuration for Cloudflare

When registering your OAuth App on GitHub ([github.com/settings/developers](https://github.com/settings/developers)):
- **Application Name:** Frontier AI Workspace
- **Homepage URL:** `https://frontier-ai.pages.dev`
- **Authorization Callback URL:** `https://frontier-ai.pages.dev/api/auth/github/callback`

---

## 6. How SQLite Maps to Cloudflare D1

Because Frontier AI was built with strict standard SQLite syntax and zero third-party ORMs, the queries run with 100% equivalence:

| Operation | Local Prototype (`node:sqlite`) | Cloudflare D1 (`env.DB`) |
|---|---|---|
| Multiple Rows | `db.prepare(sql).all(...)` | `(await env.DB.prepare(sql).bind(...).all()).results` |
| Single Row | `db.prepare(sql).get(...)` | `await env.DB.prepare(sql).bind(...).first()` |
| Insert / Update | `db.prepare(sql).run(...)` | `await env.DB.prepare(sql).bind(...).run()` |
| Transactions | `db.exec('BEGIN; ... COMMIT;')` | `await env.DB.batch([stmt1, stmt2])` |

---

## 7. Verifying Your Live Deployment

1. Open your live URL: `https://<your-project>.pages.dev`.
2. Click **Login with GitHub** to verify OAuth redirect and session cookie issuance.
3. Check the **AI Oracle Tab**: Ask a question — it will consult your sprint tasks and long-term memory.
4. Cast a vote in the **Voting** module: Verify cryptographic HMAC blind token verification works seamlessly.
5. All logs are visible in real-time in the Cloudflare Dashboard under **Pages** → **Deployments** → **Functions Logs**.
