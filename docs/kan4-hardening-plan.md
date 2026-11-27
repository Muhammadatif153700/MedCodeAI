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
2. Create `backend/.env.test` (gitignored via `.gitignore:5:.env.*`) with:
   - `NODE_ENV=test`
   - `DATABASE_URL` & `DIRECT_URL` pointing **only** to `ali_integration_test`
   - `SEED_APPROVED_ENDPOINTS=<ali_integration_test_endpoint_id>`
   - `JWT_SECRET=<test-secret-32+-chars>`
3. **Safety Guard in Test Harness:** Before running integration tests, assert `process.env.TEST_DB_ENDPOINT === actualEndpointId` and refuse if endpoint matches `ali_dev` or `production`.
4. **Execution Steps:**
   - Apply all migrations from scratch (`npx prisma migrate deploy`) → verify 26 tables + 5 constraints.
   - Run `seed.js` → verify idempotency.
   - Run real HTTP + PostgreSQL tests: writes, `AuditService` rollback on forced error, `P2002` duplicate email/NPI, `P2003` dependent deletes, all 5 `CHECK`/composite-FK violations, concurrent `Serializable` admin demotions, and invalid encounter transitions.

---

## 3. Phase 9C DX & CI Plan (Enhancements)
* **OpenAPI 3.x + Swagger UI:** Document all `KAN-4` endpoints at `/api/v1/docs` (disabled or gated in `production`).
* **Postman Collection & Env Template:** Export under `docs/postman/` with safe placeholders.
* **GitHub Actions CI (`.github/workflows/backend-ci.yml`):** Run `npm ci`, `npx prisma validate`, `npx prisma generate`, and `npm test` on PRs to `dev`/`main`.
