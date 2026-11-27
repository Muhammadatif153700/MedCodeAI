# MedCodeAI — CI/CD & Isolated PostgreSQL Strategy Guide

## 1. GitHub Actions Workflow (`.github/workflows/backend-ci.yml`)
- **Triggers:** Pull requests to `dev` and `main`; pushes to `dev`, `main`, and `feature/**` (filtered on `backend/**` and `.github/workflows/backend-ci.yml`); and `workflow_dispatch`.
- **Security & Concurrency:** Minimal `permissions: { contents: read }` and `cancel-in-progress: true` per ref.
- **Checks Executed:**
  1. `actions/checkout@v4`
  2. `actions/setup-node@v4` (`node-version: '24.x'`, npm cache on `backend/package-lock.json`)
  3. `npm ci` (in `backend/`)
  4. `npm run prisma:validate` (using harmless `localhost` placeholder URLs)
  5. `npm run prisma:generate`
  6. `npm run docs:validate` (OpenAPI 3.0.3 validation)
  7. `npm run test:coverage` (all mocked Jest regression suites including `swagger.test.js`)
  8. `actions/upload-artifact@v4` (`backend/coverage/`)
- **Note:** GitHub-hosted workflow execution is verified by inspection locally and will run on GitHub once pushed.

---

## 2. Real PostgreSQL CI Strategy (Future Enhancement Plan)
- **Recommendation:** Use an ephemeral GitHub Actions `postgres:16` service container on `localhost:5432` (never shared Neon `ali_dev` or `production` credentials, and without weakening `testDbGuard.js` Neon endpoint rules).
- **Guard Plan:** Add a separate CI-only guard mode (e.g., `CI_EPHEMERAL_POSTGRES=true` requiring `NODE_ENV=test`, `localhost`/`postgres` host, and `medcodeai_ci` DB name) before running `prisma migrate deploy`, `prisma db seed`, `npm run test:integration`, and `npm run test:newman`.
