# MedCodeAI — Team Integration Checklist (`KAN-4` -> `dev`)

## 1. Pre-Merge Database & Environment Checklist
- [ ] Run `cd backend && npm run prisma:migrate:deploy` and `npm run prisma:generate` on your own Neon dev branch to apply `20261127000000_phase9b_security_hardening` (`users.token_version`, nullable `audit_logs.user_id`).
- [ ] Ensure `backend/.env` has `JWT_SECRET` >= 32 characters (enforced at startup by `env.js` and `server.js`).
- [ ] Never commit `.env`, `.env.test`, or `.env.upgrade.test` (all ignored by `.gitignore`).

## 2. Shared Imports & Contracts
- **Auth & RBAC:** `const { authenticate } = require('../../middleware/auth.middleware');` and `const { authorize } = require('../../middleware/rbac.middleware');`
- **Audit Logging:** `const { AuditService, AUDIT_ACTIONS, AUDIT_ENTITIES } = require('../audit');`
- **Encounter Lifecycle:** `const { startCoding, markValidated, markClaimSubmitted, closeEncounter } = require('../encounters');`

## 3. Teammate Responsibilities & Merge Workflow
- **Atif (`KAN-6`):** Compatibility repairs for `origin/dev` (`1756fd4`, `d59e986`) are implemented on `feature/kan-4-backend` (see [docs/kan6-compatibility-repair.md](./kan6-compatibility-repair.md)). Please review the diff, configure `ML_API_URL` when testing the live Python ML service, and confirm whether `ValidationResult` revalidation should replace prior rows or add a `runId`/`createdAt` migration later.
- **Farhan (`KAN-5`) & Haseeb (`KAN-7`):** Pass `{ tx }` into `startCoding()` / `markClaimSubmitted()` inside your Prisma transactions.
- **Frontend Team:** Consume `/api/v1/*` with `Authorization: Bearer <jwt>`; see `http://localhost:5000/api-docs` and `docs/kan4-api-quick-reference.md`. Never connect frontend directly to PostgreSQL.
