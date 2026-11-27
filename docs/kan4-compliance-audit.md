# MedCodeAI — KAN-4 Requirements & Compliance Audit (`Phase 9A`)

> **Audit Scope:** All 13 assigned `KAN-4` tasks (`KAN-8` through `KAN-20`) cross-referenced against the Deliverable 2 PDF (`FR-01`–`FR-30`, `NFR-01`–`NFR-12`, `UC-01`–`UC-30`, Table 2, Section 3.3 ERD, State Diagrams) and `feature/kan-4-backend` (`902d1c9`).

---

## 1. Traceability Matrix (`KAN-8` to `KAN-20`)

| Jira | Req IDs | Description | Implementing File & Symbol | Test Evidence | Status | Gap / Correction |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `KAN-8` | `NFR-01,03,05,08,09,10` | Express 5 skeleton, Helmet, CORS, rate-limit, Zod, error handling, `/health` | `src/app.js`, `src/server.js`, `src/config/env.js`, `src/middleware/{error,requestId,validate}.middleware.js`, `src/routes/index.js` | `app.test.js`, `env.test.js`, `validate.test.js` | **FULLY IMPLEMENTED** | — |
| `KAN-9` | `NFR-02,09,10` | Neon PostgreSQL + Prisma 6.19.3 singleton, `/health/db` | `src/config/prisma.js`, `prisma/schema.prisma`, `scripts/verify-db.js`, `src/routes/index.js` | `healthDb.test.js` + live `db:verify` | **FULLY IMPLEMENTED** | — |
| `KAN-10` | `Sec 3.3 ERD` | 26-table schema, 11 enums, relations, indexes | `prisma/schema.prisma` | `schema.test.js` + `test:db:integrity` | **FULLY IMPLEMENTED** | Composite relation `EncounterPlanPayer` declared; `tokenVersion` & nullable `audit_logs.user_id` added. |
| `KAN-11` | `Sec 3.3, NFR-10` | Initial SQL migration, 5 PG constraints, idempotent synthetic seed | `prisma/migrations/20261125000000_init/migration.sql`, `prisma/seed.js` | `seed.test.js`, `constraints.integration.test.js`, `test:db:migrate:deploy`, `test:db:seed`, `test:db:upgrade` | **FULLY IMPLEMENTED & VERIFIED** | Fresh `medcodeai_test` & existing-data `medcodeai_upgrade_test` upgrades both verified cleanly. |
| `KAN-12` | `FR-01, UC-01, NFR-01` | Public registration (`PENDING`, `roleId: null`, no JWT, atomic audit) | `src/modules/auth/{auth.service.js#register, auth.controller.js, auth.schemas.js}` | `auth.test.js`, `authentication.integration.test.js` | **FULLY IMPLEMENTED** | — |
| `KAN-13` | `FR-02, UC-02, NFR-01,10` | Login, `HS256` JWT, `/auth/me`, disabled/pending checks | `src/modules/auth/{auth.service.js#login, jwt.util.js}`, `src/middleware/auth.middleware.js#authenticate` | `auth.test.js`, `authRbac.test.js`, `authentication.integration.test.js` | **FULLY IMPLEMENTED** | `tv` (`tokenVersion`) revocation & early startup `JWT_SECRET` validation enforced. |
| `KAN-14` | `FR-05, Table 2` | RBAC `authorize(...roles)` deny-by-default | `src/middleware/rbac.middleware.js#authorize` | `authRbac.test.js` | **FULLY IMPLEMENTED** | Teammate `KAN-6` routes remain unauthenticated (`F-03`, out of KAN-4 scope). |
| `KAN-15` | `FR-05, UC-05` | Admin user list, pending, approve, reject, role assign, activate/disable, `/roles` | `src/modules/users/{user.service.js, user.routes.js, user.controller.js}` | `users.test.js`, `users.integration.test.js`, `concurrency.integration.test.js` | **FULLY IMPLEMENTED** | Hard user delete intentionally omitted in favor of `isActive: false`; `Serializable` concurrency verified. |
| `KAN-16` | `FR-04, UC-04` | Self-service `GET/PATCH /profile` & `PATCH /profile/password` | `src/modules/users/{profile.routes.js, user.service.js#updateProfile,changePassword}` | `profile.test.js`, `users.integration.test.js` | **FULLY IMPLEMENTED** | Password change increments `tokenVersion` and revokes prior JWTs. |
| `KAN-17` | `FR-06, UC-06` | Patients CRUD, non-future `dob`, non-unique `memberId`, delete guard | `src/modules/patients/*` | `patients.test.js`, `patients.integration.test.js` | **FULLY IMPLEMENTED** | Real DB CRUD, `Serializable` delete guard, and audit logs verified. |
| `KAN-18` | `FR-06, UC-06` | Providers CRUD, 10-digit string `npi`, duplicate NPI `409`, delete guard | `src/modules/providers/*` | `providers.test.js`, `providers.integration.test.js` | **FULLY IMPLEMENTED** | Real DB CRUD, `P2002` unique NPI, `Serializable` delete guard verified. |
| `KAN-19` | `FR-06, UC-06` | Encounters CRUD, payer-plan match, lifecycle transitions, delete guard | `src/modules/encounters/*` | `encounters.test.js`, `encounters.integration.test.js` | **FULLY IMPLEMENTED (KAN-6 freshness contract documented)** | Generic `PATCH` status blocked; lifecycle prerequisites enforced; `KAN-6` owns revalidation row replacement. |
| `KAN-20` | `FR-29, UC-29, Table 6` | Append-only `AuditService.log`, transaction support, Admin `GET /audit-logs` | `src/modules/audit/*` | `audit.test.js`, `audit.integration.test.js`, `transactions.integration.test.js` | **FULLY IMPLEMENTED** | Nullable `audit_logs.user_id` enables `userId: null` on unknown-email login failures. |

*(Teammate responsibilities `KAN-5`, `KAN-6`, `KAN-7`, and unassigned `UC-28` Chatbot are **NOT KAN-4 RESPONSIBILITY**.)*
