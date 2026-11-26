# MedCodeAI — Backend Conventions & Team Integration Guide

> **Current Status (Phase 6 / KAN-12, KAN-13, KAN-14):** Express 5 skeleton, Prisma 6 + Neon PostgreSQL, 26-table schema, initial migration, synthetic seed data, **Audit Logging (`KAN-20`)**, **Registration (`KAN-12`)**, **JWT Login (`KAN-13`)**, **RBAC (`KAN-14`)**, and Admin-only `GET /api/v1/audit-logs` are complete. **User/Profile management (`KAN-15`–`KAN-16`) and Patients/Providers/Encounters CRUD (`KAN-17`–`KAN-19`) are NOT implemented yet.**

See [authentication-rbac.md](./authentication-rbac.md), [team-handover.md](./team-handover.md), [audit-logging.md](./audit-logging.md), [database-schema.md](./database-schema.md), and [database-contracts.md](./database-contracts.md).

---

## 1. Backend Architecture

MedCodeAI uses a **modular monolithic Express 5** architecture written in **JavaScript (CommonJS)**:

```text
Request -> RequestId -> Helmet -> CORS -> RateLimiter -> JSON Parser -> /api/v1 Router -> Module Route -> Validation -> Controller -> Service -> (Prisma in Phase 2+)
                                                                                                                                      |
                                                                                                                           notFoundHandler -> errorHandler
```

- `src/app.js` exports the configured Express app without binding a port (enabling Supertest integration tests).
- `src/server.js` creates the HTTP server, binds `PORT`, and handles `SIGINT`/`SIGTERM` graceful shutdown.

---

## 2. Module Ownership

| Directory (`backend/src/modules/`) | Jira Epic | Owner |
| :--- | :--- | :--- |
| `auth/`, `users/`, `patients/`, `providers/`, `encounters/`, `audit/` | `KAN-4` | Ali |
| `records/`, `coding/` | `KAN-5` | Farhan |
| `payers/`, `validation/` | `KAN-6` | Atif |
| `claims/`, `reports/` | `KAN-7` | Haseeb |

Do not modify another teammate's module directory without coordination.

---

## 3. API Base Path

All API endpoints must be mounted under:

```text
/api/v1
```

Example: `GET /api/v1/health`.

---

## 4. Response and Error Formats

### Success Response
Use `sendSuccess(res, statusCode, data, meta)` from `src/utils/ApiResponse.js`:

```json
{
  "success": true,
  "data": {},
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 100
  }
}
```
(`meta` is omitted when not provided.)

### Error Response
Throw or pass `new ApiError(statusCode, code, message, details)` to `next(err)`:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": []
  }
}
```
(`details` is omitted when not provided. Stack traces are never exposed in production.)

---

## 5. Environment Variable Conventions

See `backend/.env.example`. Variables are validated at startup via `src/config/env.js` (Zod):

- `NODE_ENV`: `development` | `test` | `production` (default: `development`)
- `PORT`: integer `1..65535` (default: `5000`)
- `CORS_ORIGINS`: comma-separated allowlist (default: `http://localhost:3000`)
- `DATABASE_URL`, `DIRECT_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`: optional in Phase 1; required in Phase 2+/3+.

Never commit `.env` or real credentials.

---

## 6. Shared Utility Import Paths

From inside `backend/src/modules/<module>/`:

- `const { env } = require('../../config/env');`
- `const { prisma, checkDatabaseHealth, disconnectPrisma } = require('../../config/prisma');`
- `const HTTP_STATUS = require('../../constants/httpStatus');`
- `const { ROLES, PENDING_ROLE } = require('../../constants/roles');`
- `const ApiError = require('../../utils/ApiError');`
- `const { sendSuccess } = require('../../utils/ApiResponse');`
- `const asyncHandler = require('../../utils/asyncHandler');`
- `const validate = require('../../middleware/validate.middleware');`

Confirmed business roles: `ADMIN`, `BILLING_SPECIALIST`, `CODER`, `REVIEWER`. (`PENDING` is a proposed non-privileged registration role/state subject to confirmation during `KAN-12`/`KAN-13`.)

---

## 7. Neon PostgreSQL & Prisma Configuration

- **Shared Prisma Client:** Always import `{ prisma }` from `backend/src/config/prisma.js`. Never instantiate `new PrismaClient()` inside controllers, services, or request handlers.
- **Pooled vs. Direct Connections:**
  - `DATABASE_URL` (Neon `-pooler` endpoint with `?sslmode=require`): Used at runtime by `@prisma/client` for application queries via PgBouncer connection pooling.
  - `DIRECT_URL` (Neon direct non-pooler endpoint with `?sslmode=require`): Used by Prisma CLI (`prisma migrate dev`, `prisma migrate deploy`) to avoid PgBouncer prepared-statement/advisory-lock issues.
- **Health Endpoints:**
  - `GET /api/v1/health` — Application liveness (HTTP `200`, independent of database).
  - `GET /api/v1/health/db` — Database readiness (`SELECT 1` read-only check; HTTP `200` when connected, HTTP `503` `DATABASE_UNAVAILABLE` when unreachable).
- **Database Branch Isolation:**
  - `production` branch is protected and must **never** be used for local development, migrations, or tests.
  - Each developer works against their own Neon development branch (e.g., `ali_dev` in AWS Singapore).
- **Troubleshooting:**
  - *`DATABASE_URL is not set`*: Copy `backend/.env.example` to `backend/.env` and add your private Neon URLs.
  - *`Invalid environment configuration`*: Ensure both `DATABASE_URL` and `DIRECT_URL` start with `postgresql://` or `postgres://` and include `?sslmode=require`.
  - *Prisma migrate hangs*: Confirm `DIRECT_URL` does **not** contain `-pooler` in its hostname.
  - *Engine missing error*: Run `npm run prisma:generate` inside `backend/`.

---

## 7. Route Registration Process

1. Create `<module>.routes.js` inside `backend/src/modules/<module>/`.
2. Mount it in `backend/src/routes/index.js`:
   ```js
   router.use('/patients', patientRoutes);
   ```
3. Wrap async controller handlers with `asyncHandler(...)` and validate inputs with `validate({ body, query, params })`.

---

## 8. Local Development Instructions

```bash
cd backend
npm install
copy .env.example .env   # or cp .env.example .env on macOS/Linux
npm run dev              # nodemon hot-reload on PORT (default 5000)
npm test                 # Jest + Supertest
npm run test:coverage    # Coverage report
```

---

## 9. Git Collaboration Rules

- Never commit directly to `main` or `dev`.
- Create feature branches per epic/task (e.g., `feature/kan-4-backend`).
- Open Pull Requests into `dev` after local tests pass.
- Never commit `node_modules/`, `.env`, `coverage/`, or uploaded files.

---

## 10. Database Migration Ownership Strategy

- **KAN-4** owns `backend/prisma/schema.prisma`, `backend/prisma/migrations/`, and `seed.js`.
- Only the schema owner runs `prisma migrate dev` against `ali_dev` to generate migration files.
- Teammates pull migrations from `dev` and apply them to their own Neon dev branches using `npx prisma migrate deploy`.
- Never run migrations or tests against `production`.

---

## 11. Synthetic Medical Data Requirement

This project is HIPAA-aligned at the design level only. **Use strictly synthetic or de-identified data** for all patients, encounters, medical records, and test fixtures. Never upload real Protected Health Information (PHI) or log sensitive medical payloads.
