# MedCodeAI — Final KAN-4 Backend Handover (`Milestone 3`)

> **Branch:** `feature/kan-4-backend` (pre-merge KAN-4 backup: `backup/kan-4-pre-milestone3-merge` @ `c97ee01d000b9e3b52effc450f2bf28dc1a5742a`; merged with `origin/dev` `d59e986` @ `25b81bfa3e787b5510bf21709fafe49ab64dee4e`).
> **Critical Blocker Before `dev` Merge / Deployment:** `origin/dev` (`KAN-6` commits `1756fd4`, `d59e986`) introduced startup-breaking `authorize([ROLES...])` array calls and non-destructured `prisma`/`env` imports in `payers/` and `validation/`. See Section 7 below.

---

## 1. KAN-4 Jira Subtask Status (`KAN-8` through `KAN-20`)
All 13 `KAN-4` subtasks are **implemented, security-hardened, and verified** on isolated PostgreSQL databases (`medcodeai_test` & `medcodeai_upgrade_test`) prior to merging `origin/dev`:
- `KAN-8`: Express 5 skeleton, Helmet, CORS, rate limiting, Zod validation, centralized error handler, `/health`
- `KAN-9`: Neon PostgreSQL + Prisma `6.19.3` singleton, `/health/db`
- `KAN-10`: 26-table schema, 11 enums, composite `EncounterPlanPayer` relation
- `KAN-11`: Initial migration + 5 custom PG constraints + idempotent seed + existing-data upgrade verified
- `KAN-12`: Public registration (`PENDING`, `roleId: null`, bcrypt, email normalization)
- `KAN-13`: Login (`HS256` JWT with `tv` claim), `/auth/me`, disabled/pending/rejected checks
- `KAN-14`: Deny-by-default RBAC `authorize(...allowedRoles)`
- `KAN-15`: Admin user management (`/users`, `/users/pending`, `approve`, `reject`, `role`, `status`, `/roles`)
- `KAN-16`: Self-service profile (`GET/PATCH /profile`, `PATCH /profile/password` with `tokenVersion` revocation)
- `KAN-17`: Patient CRUD + `Serializable` delete guard
- `KAN-18`: Provider CRUD + unique 10-digit string NPI + `Serializable` delete guard
- `KAN-19`: Encounter CRUD + `EncounterService` lifecycle (`startCoding`, `markValidated`, `markClaimSubmitted`, `closeEncounter`)
- `KAN-20`: Append-only `AuditService.log`, nullable `audit_logs.user_id` for unknown-email login failures, Admin `GET /audit-logs`

---

## 2. API Inventory, Role Matrix & Shared Imports
- **OpenAPI 3.0.3 (`32` KAN-4 operations):** `backend/docs/openapi.yaml` (`npm --prefix backend run docs:validate`).
- **Swagger UI (non-production only):** `GET /api-docs` and `GET /api-docs/openapi.json` (hard-disabled in `NODE_ENV=production`).
- **Quick Reference & Role Matrix:** [kan4-api-quick-reference.md](./kan4-api-quick-reference.md).
- **Shared Imports (Exact):**
  - `const { prisma } = require('../../config/prisma');`
  - `const { env } = require('../../config/env');`
  - `const { authenticate } = require('../../middleware/auth.middleware');`
  - `const { authorize } = require('../../middleware/rbac.middleware');` (variadic `authorize(ROLES.ADMIN, ROLES.CODER)`, **not** an array)
  - `const { AuditService, AUDIT_ACTIONS, AUDIT_ENTITIES } = require('../audit');` (`AuditService.log({ userId, action, entity, entityId, ipAddress }, { tx })`)
  - `const { startCoding, markValidated, markClaimSubmitted, closeEncounter } = require('../encounters');`

---

## 3. Breaking Authentication & Database Changes (Phase 9B)
- **JWT `tokenVersion` (`tv` claim):** Existing JWTs without `tv` or with stale `tv` are rejected with `401`. Password changes, role reassignments, and status changes increment `users.token_version`.
- **Nullable `audit_logs.user_id`:** Allowed only for unauthenticated security events (`USER_LOGIN_FAILED`); normal business mutations still require a valid `userId`.
- **Migration Rollout:** See [phase9b-migration-guide.md](./phase9b-migration-guide.md) and exact rollout commands in the Milestone 3 Part 1 report.

---

## 4. Postman, Newman & CI
- **Postman Collection & Environment:** `postman/MedCodeAI-KAN4.postman_collection.json` (`68` requests, `77` assertions), `postman/MedCodeAI-Local.postman_environment.json`.
- **Guarded Test Commands:** `test:db:verify`, `test:db:migrate:deploy`, `test:db:migrate:status`, `test:db:seed`, `test:db:integrity`, `test:db:upgrade`, `test:integration`, `test:newman`.
- **CI Workflow:** `.github/workflows/backend-ci.yml` (runs `npm ci`, `prisma validate/generate`, `docs:validate`, `test:coverage` on Node `24.x`).

---

## 5. Teammate Integration Status (`KAN-6` Compatibility Repaired Locally)
All 5 `KAN-6` compatibility defects introduced by `origin/dev` (`1756fd4`, `d59e986`) have been **repaired non-destructively** on `feature/kan-4-backend` (see [kan6-compatibility-repair.md](./kan6-compatibility-repair.md)):
1. `payers.routes.js` & `validation.routes.js`: converted `authorize([...])` to variadic `authorize(...)` + shared `validate` middleware.
2. `payers.controller.js`, `validation.routes.js`, `validation.service.js`: switched to `{ prisma }` and `{ env }` destructuring.
3. `env.js`, `.env.example`, `.env.test.example`: added optional validated `ML_API_URL` and `ML_API_TIMEOUT_MS` (`10000`).
4. `payers.controller.js` & `validation.routes.js`: wired atomic `AuditService.log({ ... }, { tx })` calls.
5. `validation.routes.js` & `validation.service.js`: external ML call runs outside DB tx; DB writes + `CLAIM_VALIDATED` audit + conditional `markValidated()` run inside `Serializable` tx.
*(Remaining: real Python ML service end-to-end test when `ML_API_URL` is running, and team agreement on `ValidationResult` revalidation retention vs replacement.)*
