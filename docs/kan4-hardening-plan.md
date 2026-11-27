# MedCodeAI — Phase 9B/9C Hardening & Disposable DB Testing Plan

---

## 1. Phase 9B Hardening Scope (Security, Correctness & Coverage)
1. **Encounter Workflow Guard (`F-01`):** Replace unrestricted `VALIDATED`/`CLAIM_SUBMITTED` transitions on `PATCH /encounters/:id` with `EncounterService.transitionStatus()` verifying actual `ValidationResult` / `Claim` prerequisites; prevent silent `payerId`/`planId` mutation after coding/validation.
2. **JWT Revocation on Password Change (`F-02`):** Forward-only migration adding `users.token_version Int @default(0)` + `authenticate()` check (`decoded.tv === user.tokenVersion`) + increment in `UserService.changePassword()` (and optionally on disable/role-change).
3. **Unknown-User Failed Login Auditing (`F-05`):** Forward-only migration making `audit_logs.user_id` nullable (`Int?`) so `AuditService.log()` can persist `USER_LOGIN_FAILED` with `userId: null` without fabricating a user ID.
4. **Schema Drift Alignment (`F-04`):** Declare named composite relation on `Encounter` (`@relation("EncounterPlanPayer", fields: [planId, payerId], references: [id, payerId])`) so `prisma migrate diff` reports zero drift.
5. **Unit Test Coverage Expansion (`F-07`, `F-08`):** Bring `patients/`, `providers/`, `encounters/`, and `users/` to ≥90% statements and ≥80% branches.

---

## 2. Disposable Neon Integration Test Branch Plan (`ali_integration_test`)

> **Safety Rule:** Never run destructive tests on `ali_dev` or `production`.

### Manual Setup (When Approved)
1. In **Neon Console → `MedCodeAI`**, create a blank/parent-less or `production`-branched disposable branch named **`ali_integration_test`**.
2. Create `backend/.env.test` from `backend/.env.test.example` (gitignored via `.gitignore:6:.env.*`) with:
   - `NODE_ENV=test`
   - `TEST_EXPECTED_DB_NAME=medcodeai_test`
   - `TEST_APPROVED_ENDPOINTS` & `SEED_APPROVED_ENDPOINTS` set to the `ali_integration_test` endpoint ID
   - `DATABASE_URL` (pooled) & `DIRECT_URL` (direct) pointing **only** to `ali_integration_test`
   - `JWT_SECRET` (at least 32 characters, enforced at server startup by `env.js` and `server.js`) and `SEED_*_PASSWORD` variables (at least 8 characters)
3. **Safety Guard in Test Harness (`backend/src/config/testDbGuard.js` & `backend/scripts/run-test-db.js`):** Guarded npm commands (`test:db:verify`, `test:db:migrate:deploy`, `test:db:migrate:status`, `test:db:seed`, `test:db:integrity`) refuse `ali_dev`, `production`, non-allowlisted endpoints, and DB name mismatches.
4. **Phase 9C Part 2 Execution Status (Verified on `medcodeai_test`):**
   - Verified empty `medcodeai_test` (`0` tables), applied `20261125000000_init` and `20261127000000_phase9b_security_hardening` via `test:db:migrate:deploy`, and confirmed `26` application tables + `5` custom constraints via `test:db:integrity`.
   - Ran `test:db:seed` twice idempotently (`4` roles, `8` users with `tokenVersion = 0`, `10` patients, `5` providers, `3` payers, `6` plans, `15` encounters) and smoke-tested live `/health`, `/health/db`, `/auth/login` (`tv: 0`), `/auth/me`, and RBAC enforcement.
   - **Next (Phase 9D):** Real HTTP + PostgreSQL integration suite covering writes, `AuditService` rollback on forced error, `P2002` duplicate email/NPI, `P2003` dependent deletes, all 5 `CHECK`/composite-FK violations, concurrent `Serializable` admin demotions, and invalid encounter transitions.

---

## 3. Phase 9C DX & CI Plan (Enhancements)
* **OpenAPI 3.x + Swagger UI:** Document all `KAN-4` endpoints at `/api/v1/docs` (disabled or gated in `production`).
* **Postman Collection & Env Template:** Export under `docs/postman/` with safe placeholders.
* **GitHub Actions CI (`.github/workflows/backend-ci.yml`):** Run `npm ci`, `npx prisma validate`, `npx prisma generate`, and `npm test` on PRs to `dev`/`main`.
