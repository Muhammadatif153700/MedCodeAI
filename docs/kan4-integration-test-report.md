# MedCodeAI — KAN-4 Real PostgreSQL Integration Test Report (Phase 9D)

> **Target Database:** `medcodeai_test` (`ep-withered-rain-bi13x7sf`, Neon branch `ali_integration_test`)
> **Isolation Policy:** Guarded by `backend/src/config/testDbGuard.js` + `backend/scripts/run-test-db.js`; `ali_dev`, teammate databases, and `production` were never touched.

---

## 1. Architecture & Execution Command

- **Jest Config:** `backend/jest.integration.config.js` (`--runInBand`, `testTimeout: 60000`, `setupFiles: ['<rootDir>/tests/integration/setup.js']`)
- **Guarded Command:** `npm --prefix backend run test:integration`
- **Fixture Isolation:** `backend/tests/integration/helpers.js` generates unique synthetic records per run and deletes only tracked test records in reverse foreign-key order without touching seeded data or using unrestricted `deleteMany` / `TRUNCATE` / `DROP`.

---

## 2. Real PostgreSQL Integration Suites (9 Suites, 18 Tests)

| Suite | Scope Verified |
| :--- | :--- |
| `authentication.integration.test.js` | Registration (`PENDING`, `roleId: null`, bcrypt, email normalization), duplicate `EMAIL_ALREADY_REGISTERED`, unknown/wrong-password/disabled/rejected logins, `tv` JWT claims, `/auth/me`, invalid/expired/missing-`tv`/wrong-`tv` rejection |
| `users.integration.test.js` | Admin listing/search/filter/pagination, pending users, approval/rejection, invalid transitions, role assignment, self-disable/self-demotion guards, last-admin invariant, profile CRUD, password change & multi-step JWT revocation (`tokenVersion` 0→1→2→3) |
| `patients.integration.test.js` | CRUD, DOB/future-date/gender/extra-field validation, non-unique `memberId`, search/pagination, 404 handling, RBAC (`REVIEWER` 403), dependent-encounter delete block (`409`), audit logs |
| `providers.integration.test.js` | CRUD, leading-zero NPI preservation, invalid NPI (`400`), duplicate NPI (`409` + direct PG `P2002`), search/specialty filter/pagination, empty `PATCH` (`400`), dependent-encounter delete block (`409`), audit logs |
| `encounters.integration.test.js` | CRUD, client `status` rejection, 404/400 reference & `PAYER_PLAN_MISMATCH`, metadata lock after dependents, generic `PATCH` status rejection, `startCoding` / `markValidated` / `markClaimSubmitted` / `closeEncounter`, cross-encounter isolation, `ENCOUNTER_UPDATED` audits |
| `audit.integration.test.js` | Real `audit_logs` persistence for auth/admin/profile/CRUD, `userId: null` unknown-email failed login, null-actor rejection for business mutations, admin-only `GET /api/v1/audit-logs`, no credential leakage |
| `constraints.integration.test.js` | All 5 custom PG constraints (`coding_suggestions_code_reference_check`, `coding_suggestions_units_positive`, `encounters_plan_payer_fkey`, `rate_references_rate_non_negative`, `users_approved_requires_role`) + unique email/NPI, FK, `ON DELETE RESTRICT`, `token_version` default `0` |
| `transactions.integration.test.js` | Atomic commit (Patient + AuditLog), forced audit failure rolling back Patient insert, failed approval/password/transition/delete leaving DB state unchanged |
| `concurrency.integration.test.js` | Barrier-coordinated concurrent provider NPI, normalized-email registration, simultaneous password changes, mutual admin deactivation, and concurrent `startCoding` (`Serializable` conflict handling) |

---

## 3. Known Limitations & Teammate Dependencies

- **Validation Freshness (`KAN-6` Contract Limitation):** `ValidationResult` in `schema.prisma` has no `createdAt`, `runId`, or coding-snapshot hash. `markValidated()` fails closed on any `FAILED` row or `SUGGESTED` coding suggestion, but `KAN-6` must clear/replace prior `ValidationResult` rows inside its revalidation transaction.
- **Migration Upgrade Test (Step 14):** Deferred/pending until a separate disposable logical database with pre-Phase-9B old-schema data is provisioned (do not roll back `medcodeai_test` or touch `ali_dev`).
- **`KAN-6` Route Security (`F-03`):** `/api/v1/payers/*` and `/api/v1/validation/*` remain owned by `KAN-6`.
