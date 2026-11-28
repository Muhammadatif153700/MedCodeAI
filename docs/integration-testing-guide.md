# MedCodeAI — Isolated Integration Testing Guide

## Purpose

Integration tests, Prisma migration verification, and database reset checks **must never** execute against the shared Neon development branch (`ali_dev`, endpoint `ep-mute-sunset-bixgh0vc`) or any production database.

All destructive or schema-mutating integration tests must target a **disposable isolated Neon branch** (recommended name: `ali_integration_test`).

---

## 1. Environment Configuration (`backend/.env.test`)

1. Copy `backend/.env.test.example` to `backend/.env.test`.
2. Populate `DATABASE_URL` (pooled Neon URL containing `-pooler`) and `DIRECT_URL` (direct Neon URL **without** `-pooler`) for your disposable Neon branch (`ali_integration_test`).
3. Set `TEST_APPROVED_ENDPOINTS` and `SEED_APPROVED_ENDPOINTS` to the exact Neon endpoint ID(s) of your disposable branch (comma-separated if multiple).
4. Set `TEST_EXPECTED_DB_NAME=medcodeai_test` (matching the logical database name in `DATABASE_URL` and `DIRECT_URL`).
5. Ensure `JWT_SECRET` is at least 32 characters (enforced at server startup by `env.js` and `server.js`) and `SEED_*_PASSWORD` variables are at least 8 characters.
6. Ensure `NODE_ENV=test` when running integration tests.

### `.gitignore` Protection

The repository `.gitignore` ignores `.env` and `.env.*` (while explicitly keeping `!.env.example`).
`backend/.env.test` is automatically ignored by Git and must **never** be committed.

---

## 2. Database Safety Guard (`backend/src/config/testDbGuard.js`)

Before any integration test runner or migration harness connects to PostgreSQL, call:

```js
const { assertIsolatedTestDatabase, loadAndVerifyTestEnv } = require('../config/testDbGuard');
```

`assertIsolatedTestDatabase(envObj)` enforces the following fail-closed checks:

1. `NODE_ENV` must equal `'test'`.
2. `DATABASE_URL` and `DIRECT_URL` must be present and valid PostgreSQL URLs.
3. Neither `DATABASE_URL` nor `DIRECT_URL` may target:
   - Known development endpoints (`BLOCKED_DEV_ENDPOINTS`, including `ep-mute-sunset-bixgh0vc` / `ali_dev`)
   - Any hostname or URL containing `production` or `prod`
4. `DATABASE_URL` must use the Neon `-pooler` hostname.
5. `DIRECT_URL` must **not** use `-pooler`.
6. Both `DATABASE_URL` and `DIRECT_URL` must resolve to the same endpoint ID and match `TEST_EXPECTED_DB_NAME`.
7. `TEST_APPROVED_ENDPOINTS` must be non-empty, and the resolved endpoint ID must be explicitly listed in `TEST_APPROVED_ENDPOINTS`.

---

## 3. Guarded Test Database Commands (`backend/scripts/run-test-db.js`)

Run all isolated database operations through the guarded npm scripts in `backend/package.json`. Each command loads `backend/.env.test` (overriding stale shell env vars), runs `assertIsolatedTestDatabase`, and passes the verified environment explicitly to the child process without ever falling back to `backend/.env`:

| Command | Action |
| :--- | :--- |
| `npm --prefix backend run test:db:verify` | Read-only check of database name, schema, tables, and `_prisma_migrations` |
| `npm --prefix backend run test:db:migrate:deploy` | Runs `npx prisma migrate deploy` against the verified disposable database |
| `npm --prefix backend run test:db:migrate:status` | Runs `npx prisma migrate status` against the verified disposable database |
| `npm --prefix backend run test:db:seed` | Runs `node prisma/seed.js` against the verified disposable database |
| `npm --prefix backend run test:db:integrity` | Verifies 26 tables, 5 custom constraints, `token_version`, nullable `audit_logs.user_id`, FKs, and indexes |
| `npm --prefix backend run test:integration` | Runs all 9 real PostgreSQL integration suites sequentially (`backend/jest.integration.config.js`) against `medcodeai_test` |

### Phase 9C Part 2 Verification Summary (`medcodeai_test`)
- Verified empty database (`0` tables) prior to migration.
- Applied `20261125000000_init` and `20261127000000_phase9b_security_hardening`; `migrate status` confirmed up to date.
- Executed `test:db:seed` twice idempotently (`4` roles, `8` users all with `tokenVersion = 0`, `10` patients, `5` providers, `3` payers, `6` plans, `15` encounters, and reference catalog fixtures).
- Live server smoke test verified `GET /api/v1/health` (`200`), `GET /api/v1/health/db` (`200`), `POST /api/v1/auth/login` (`200` with `tv: 0`), `GET /api/v1/auth/me` (`200`), admin-protected `GET /api/v1/users` (`200`), unauthenticated (`401`), and non-admin (`403`).
- Known limitation: `backend/.env.test` must be populated locally (never committed) with a 32+ char `JWT_SECRET` and disposable endpoint allowlist before running guarded commands or starting `src/server.js`.
