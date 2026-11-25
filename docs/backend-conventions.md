# MedCodeAI — Backend Conventions & Team Integration Guide

> **Current Status (Phase 1 / KAN-8):** Express 5 application skeleton, environment validation, shared response/error conventions, and health-check endpoint are implemented. **Database models (Prisma + Neon), JWT authentication, RBAC enforcement, and audit logging are NOT implemented yet** and will be added in upcoming KAN-4 phases.

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
- `const HTTP_STATUS = require('../../constants/httpStatus');`
- `const { ROLES, PENDING_ROLE } = require('../../constants/roles');`
- `const ApiError = require('../../utils/ApiError');`
- `const { sendSuccess } = require('../../utils/ApiResponse');`
- `const asyncHandler = require('../../utils/asyncHandler');`
- `const validate = require('../../middleware/validate.middleware');`

Confirmed business roles: `ADMIN`, `BILLING_SPECIALIST`, `CODER`, `REVIEWER`. (`PENDING` is a proposed non-privileged registration role/state subject to confirmation during `KAN-12`/`KAN-13`.)

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
