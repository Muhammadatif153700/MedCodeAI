# MedCodeAI — Dependency Security Audit & Remediation Plan (`Milestone 3 Part 2B`)

> **Audit Baseline:** `npm --prefix backend audit --omit=dev --json` (`5` high runtime) and `npm --prefix backend audit --json` (`26` total: `1` critical, `17` high, `8` moderate). `npm audit fix` (without `--force`) offers zero non-breaking SemVer-compatible updates.

---

## 1. Runtime Findings (`npm audit --omit=dev --json` — 5 High)

| Package | Installed | Advisory | Path & Classification | Remediation Plan |
| :--- | :---: | :--- | :--- | :--- |
| `zod` | `3.25.76` | `GHSA-mrhx-c7xc-m3w5` (`<4.6.6`, High) | Direct runtime (`dependencies`) | Requires SemVer-major upgrade to `zod@4.6.7`. Deferred for Milestone 3+ team approval (see Section 2). |
| `prisma`, `@prisma/config`, `deepmerge-ts`, `effect` | `6.19.3` | `GHSA-ggr8-5vv4-36mx`, `GHSA-7589-6fvf-x4pw` (High) | `devDependencies` (`prisma@6.19.3`) pulled into `--omit=dev` audit via `@prisma/client`'s `peerOptional prisma@*` | In production containers, install with `npm ci --omit=dev` (without `prisma` CLI in `node_modules`). Major upgrade to `prisma@7.10.1` deferred to keep team 6.19.3 alignment. |

---

## 2. Zod v4 Migration Assessment
- **Affected Files (10):** `src/config/env.js`, `src/middleware/validate.middleware.js`, `src/modules/auth/auth.schemas.js`, `src/modules/users/user.schemas.js`, `src/modules/patients/patient.schemas.js`, `src/modules/providers/provider.schemas.js`, `src/modules/encounters/encounter.schemas.js`, `src/modules/audit/audit.schemas.js`, `src/modules/payers/payers.routes.js`, `src/modules/validation/validation.routes.js`.
- **Breaking Changes to Address:** `z.coerce.date()`, `errorMap` / `invalid_type_error` / `required_error` API changes in Zod v4, `.strict()` -> `z.strictObject()`, and `err.issues` formatting in `validate.middleware.js`.
- **Plan:** Upgrade `zod` to `4.6.7+` in a dedicated branch with full unit + PostgreSQL integration + Newman regression.

---

## 3. Development-Only Findings (21 Additional — `newman` & `nodemon`)
- **`newman@6.2.3` (`handlebars@4.7.8` Critical, `node-forge`, `@faker-js/faker`, `flatted`, `underscore`, `uvm`, `postman-*`):** No patched Newman 6.x exists (`npm audit --force` proposes downgrading to `newman@4.6.1`). Mitigated by keeping `newman` strictly in `devDependencies` and executing only our own trusted `postman/MedCodeAI-KAN4.postman_collection.json` in isolated local/CI runs.
- **`nodemon@3.1.14` (`minimatch@10.2.6`) & `jest@29.7.0` (`minimatch@3.1.5`):** Dev-only file-watcher/test-runner dependencies.
