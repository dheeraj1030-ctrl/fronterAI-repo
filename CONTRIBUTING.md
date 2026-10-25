# Frontier AI — Development & Pull Request Guidelines

This document outlines the branching model and pull request workflow for the `fronterAI-repo`. All contributors must follow this flow to ensure clean merges, zero conflict markers, and continuous production stability.

---

## 1. Branch Architecture

```
  [feature/* / contributor-branch]
                 │
                 ▼ (Pull Request & Code Review)
             develop  (Integration Branch — active testing)
                 │
                 ▼ (Production Release PR / Fast-Forward)
               main   (Production Branch — triggers Cloudflare deployment)
```

| Branch | Purpose | Permissions / Policy |
| :--- | :--- | :--- |
| **`main`** | **Production**. Deployed live on Cloudflare Pages. | **Protected**. No direct commits or rogue PRs. Merges only from `develop`. |
| **`develop`** | **Integration & Staging**. Where all feature PRs land. | Primary target for contributor pull requests. |
| **`feature/*`** or **`fix/*`** | Specific tasks, bug fixes, UI components. | Branched off latest `develop`. |

---

## 2. Standard Contributor Workflow

### Step 1: Sync with Latest `develop`
Before starting any new work:
```bash
git checkout develop
git pull origin develop
```

### Step 2: Create a Feature or Fix Branch
```bash
git checkout -b feature/your-feature-name
# or: git checkout -b fix/your-bug-fix
```

### Step 3: Implement, Test & Verify
Ensure code passes syntax verification before committing:
```bash
node --check public/app.js
node --check functions/api/[[catchall]].js
```

### Step 4: Commit with Conventional Commits
Keep commit messages clean, concise, and descriptive (no emojis in commit messages):
```bash
git commit -m "feat(module): add sprint milestone export"
# or: git commit -m "fix(auth): preserve token in partitioned cookies"
```

### Step 5: Push Branch & Open PR against `develop`
```bash
git push -u origin feature/your-feature-name
```
- Open a Pull Request on GitHub:
  - **Base repository/branch**: `potatobun321/fronterAI-repo` -> **`develop`**
  - **Head repository/branch**: your fork or branch -> **`feature/your-feature-name`**
- Fill in the PR summary detailing the changes, affected files, and verification steps.

---

## 3. Host / Lead Review & Release Workflow

1. **Review on `develop`**: The Host/Lead reviews the PR against `develop`, runs verification checks, and merges.
2. **Release to `main`**: Once `develop` is verified stable:
   ```bash
   git checkout main
   git pull origin main
   git merge develop --ff-only
   git push origin main
   ```
   *(Or open a PR on GitHub from `develop` into `main` for release approval).*

---

## 4. Coding & Design Standards

- **Zero Emojis**: Use clean Google Workspace SVG icons or plain text badges.
- **₹0 Runtime Cost Architecture**: Rely on native Web APIs (`fetch`, standard CSS, vanilla ES modules) and Cloudflare D1 / node:sqlite.
- **Persistent Sessions**: Ensure any authenticated fetch includes Bearer headers and `credentials: 'include'`.
