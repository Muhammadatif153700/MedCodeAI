# MedCodeAI — KAN-4 Test Quality & Gap Analysis (`Phase 9A`)

> **Baseline:** `15/15` suites, `86/86` tests passed (`80.39%` overall statements, `61.10%` overall branches — pulled down by teammate `payers/` at `46.37%` and `validation/` at `33.87%`).

---

## 1. KAN-4 Module Coverage Breakdown (Separate from Teammate Modules)

| Module | Statements | Branches | Functions | Lines | Target (≥90% Stmts / ≥80% Branches) |
| :--- | :---: | :---: | :---: | :---: | :--- |
| `src/config/env.js` | `96.87%` | `79.16%` | `100%` | `96.77%` | Near target (1 branch short) |
| `src/middleware/auth.middleware.js` | `90.32%` | `85.00%` | `100%` | `90.32%` | **Meets target** |
| `src/middleware/rbac.middleware.js` | `85.71%` | `78.57%` | `100%` | `85.71%` | Add missing `authorize()` error/status branches |
| `src/modules/audit/` | `94.62%` | `83.33%` | `78.57%` | `94.50%` | **Meets target** |
| `src/modules/auth/` | `91.93%` | `88.67%` | `100%` | `91.93%` | **Meets target** |
| `src/modules/patients/` | `85.98%` | `41.37%` | `90.47%` | `85.98%` | Below branch target (`deletePatient` success, `P2003`) |
| `src/modules/providers/` | `70.24%` | `30.43%` | `66.66%` | `70.24%` | **Below target** (`updateProvider`, `deleteProvider`, `P2002`/`P2003`) |
| `src/modules/encounters/` | `81.04%` | `57.00%` | `91.66%` | `83.67%` | Below branch target (ref re-validation, `P2003`, transitions) |
| `src/modules/users/` | `86.95%` | `61.81%` | `97.77%` | `86.89%` | Below branch target (`assignRole` success, `getUserById` 404, `activate`) |

---

## 2. Prioritized Test-Gap Matrix

| Priority | Gap | Module | Recommended Test |
| :---: | :--- | :--- | :--- |
| **P1 (High)** | Live PostgreSQL writes, `P2002`/`P2003`/5 custom `CHECK` constraints, `Serializable` concurrency, & rollback | All `KAN-4` | Run real HTTP + Prisma integration suite against disposable `ali_integration_test` branch |
| **P1 (High)** | Encounter status bypass & payer/plan update invalidation | `encounters` | Test rejecting direct `PATCH` to `VALIDATED`/`CLAIM_SUBMITTED` without prerequisites |
| **P1 (High)** | JWT revocation after password change | `auth` / `users` | Test old JWT rejected (`401`) after `PATCH /profile/password` once `tokenVersion` is added |
| **P2 (Med)** | `updateProvider`, `deleteProvider` success, `P2002` on update, `P2003` catch | `providers` | Add unit tests covering lines 43–50, 82–131, 154–179 of `provider.service.js` |
| **P2 (Med)** | `deletePatient` success & `P2003` catch | `patients` | Add unit tests covering lines 113–138 of `patient.service.js` |
| **P2 (Med)** | `assignRole` success, last-admin demotion, `activate`, `getUserById` 404 | `users` | Add unit tests covering lines 228–260, 296–315 of `user.service.js` |
| **P3 (Low)** | `updateProviderSchema` empty body, `auth.middleware` empty Bearer token | `providers` / `auth` | Add boundary tests for empty `Authorization: Bearer ` and `{}` body |
