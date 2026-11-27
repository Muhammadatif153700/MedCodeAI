# MedCodeAI — Existing-Data Migration Upgrade Verification (Phase 9F Part 2)

> **Target Database:** `medcodeai_upgrade_test` (`ep-withered-rain-bi13x7sf`, Neon branch `ali_integration_test`)
> **Environment File:** `backend/.env.upgrade.test` (Git-ignored via `.gitignore:6:.env.*`)
> **Runner:** `npm --prefix backend run test:db:upgrade` (`backend/scripts/run-upgrade-test.js`)

---

## 1. Purpose & Isolation Guarantees

This verification proves that applying `20261127000000_phase9b_security_hardening` over an existing `20261125000000_init` PostgreSQL database preserves all existing users, password hashes, audit actor IDs, medical records, and custom constraints without data loss.

- Never modifies `backend/prisma/migrations/` in the repository (uses an isolated temporary workspace in `os.tmpdir()` with the local Prisma `6.19.3` binary for the old-schema stage).
- Never touches `medcodeai_test`, `ali_dev`, `production`, or teammate databases.

---

## 2. Reproducible Execution Command

```bash
npm --prefix backend run test:db:upgrade
```

---

## 3. Verified Results (`medcodeai_upgrade_test`)

1. **Empty State Verified:** `medcodeai_upgrade_test` (`public` schema) had `0` tables before starting.
2. **Initial Migration (`20261125000000_init`):** Applied cleanly (`26` application tables, `5` custom constraints, `users.token_version` absent, `audit_logs.user_id` `NOT NULL`).
3. **Old-Schema Synthetic Data (Parameterized SQL):** Inserted `4` roles, `3` users (`ADMIN`, `CODER`, `PENDING`), `2` audit logs with valid `user_id`, `1` patient, `1` provider, `2` payers, `2` insurance plans, `1` encounter, `1` medical record, `1` ICD-10 code, `1` CPT code, and `1` rate reference.
4. **Phase 9B Upgrade (`20261127000000_phase9b_security_hardening`):**
   - All pre-migration row counts, primary keys, foreign keys, password hash SHA-256 fingerprints, and audit actor IDs preserved identically.
   - All existing users received `token_version = 0`.
   - `audit_logs.user_id` became nullable (`YES`).
   - All `5` custom constraints remained enforced (`encounters_plan_payer_fkey`, `users_approved_requires_role`, `rate_references_rate_non_negative`, `coding_suggestions_units_positive`, `coding_suggestions_code_reference_check`).
   - `_prisma_migrations` recorded both migrations with `rolled_back_at: null` and matching SHA-256 checksums (`DC48EEAB161A70AFAE272F5B41C8DB743E86C1404326C4C0EDD78F3C06768CD7` and `0C3FE3ADA6241FBE26D4DF5EA2F0260021F07EB4050CF1425740DF51A273FA3D`).
5. **Post-Migration Live Server Checks (`PORT=5097`):**
   - Existing `ADMIN`/`CODER` login (`200`, `tv: 0`), `PENDING` blocked (`403`), `/api/v1/profile` (`200`), legacy JWT without `tv` rejected (`401`), password change (`200`) revokes old token (`401`) and increments `tv` (`1`), disabled login blocked (`403`), unknown-email login (`401`) persists `user_id = NULL` `USER_LOGIN_FAILED`, existing patient/provider/encounter accessible (`200`), `PAYER_PLAN_MISMATCH` rejected (`400`), dependent patient deletion blocked (`409`).
6. **Idempotency:** Second `prisma migrate deploy` reported `No pending migrations to apply.` (`2` `_prisma_migrations` rows, `1` `token_version` column).

---

## 4. Rollback Limitations & Risks

- `20261127000000_phase9b_security_hardening` is forward-only; once `user_id = NULL` rows exist in `audit_logs`, `ALTER COLUMN "user_id" SET NOT NULL` cannot be rolled back without handling null-actor security rows.
- Teammate branches must run `npm run prisma:migrate:deploy` and `npm run prisma:generate` after merging `feature/kan-4-backend`.
