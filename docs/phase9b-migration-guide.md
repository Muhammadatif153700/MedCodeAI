# MedCodeAI — Phase 9B Migration & Rollout Guide

> **Migration Name:** `20261127000000_phase9b_security_hardening`
> **Target Status:** Applied and verified on isolated disposable branch `ali_integration_test` (`medcodeai_test`); **not yet applied to `ali_dev` or teammate branches** awaiting rollout approval.

---

## 1. SQL Changes Included
```sql
BEGIN;

ALTER TABLE "users"
ADD COLUMN "token_version" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "audit_logs"
ALTER COLUMN "user_id" DROP NOT NULL;

COMMIT;
```
* **Explicit Transaction Wrapper:** Prisma does **not** explicitly wrap PostgreSQL `migration.sql` files in `BEGIN; ... COMMIT;` by default, so this forward-only migration includes explicit `BEGIN;` and `COMMIT;` statements to guarantee atomic execution.
* **Non-Destructive:** Zero `DROP`, `TRUNCATE`, or data deletion. Existing `users` rows default to `token_version = 0`; existing `audit_logs` rows remain intact and `audit_logs_user_id_fkey` (`ON DELETE RESTRICT`, `ON UPDATE CASCADE`) remains enforced.

---

## 2. Rollout Steps (After Approval)
1. **Deploy Migration:**
   ```powershell
   cd backend
   npm run prisma:migrate:deploy
   npm run prisma:migrate:status
   ```
2. **Regenerate Prisma Client & Restart Backend:**
   ```powershell
   npm run prisma:generate
   ```
3. **Token Invalidation Notice:**
   * All JWTs issued before Phase 9B lack the `tv` (`tokenVersion`) claim and will be rejected with `401 INVALID_TOKEN`. Existing users simply log in again via `POST /api/v1/auth/login` to receive a `tv`-enabled token.

---

## 3. Teammate Branch Sync
Once merged into `dev`, Farhan, Atif, and Haseeb should pull `dev` and run `npm run prisma:migrate:deploy` + `npm run prisma:generate` against their own Neon development branches (never `production`).
