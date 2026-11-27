# MedCodeAI
AI-Powered Medical Coding and Claim Validation System

## Backend Setup (Phase 1)

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a local environment file from the template:
   ```bash
   copy .env.example .env
   ```
   *(On macOS/Linux: `cp .env.example .env`)*
4. Start the development server:
   ```bash
   npm run dev
   ```
   Or start in standard mode:
   ```bash
   npm start
   ```
5. Verify endpoints:
   - Application liveness: `GET http://localhost:5000/api/v1/health`
   - Database readiness: `GET http://localhost:5000/api/v1/health/db`
6. Prisma & Neon PostgreSQL commands:
   ```bash
   npm run prisma:validate       # Validate prisma/schema.prisma
   npm run prisma:generate       # Generate Prisma Client
   npm run prisma:migrate:deploy # Apply committed migrations to your Neon dev branch
   npm run prisma:migrate:status # Check migration status
   npm run db:seed               # Run idempotent synthetic development seed
   npm run db:verify             # Run read-only SELECT 1 check on pooled & direct URLs
   ```
7. Guarded isolated test database commands (`backend/.env.test`, see [docs/integration-testing-guide.md](./docs/integration-testing-guide.md)):
   ```bash
   npm run test:db:verify         # Verify empty/current state on isolated test DB
   npm run test:db:migrate:deploy # Deploy migrations to isolated test DB
   npm run test:db:migrate:status # Check migration status on isolated test DB
   npm run test:db:seed           # Run idempotent seed on isolated test DB
   npm run test:db:integrity      # Verify 26 tables, 5 custom constraints, and Phase 9B columns
   ```
8. Run automated tests:
   ```bash
   npm test                # Run mocked unit test suites (16 suites)
   npm run test:coverage   # Run mocked unit tests with coverage
   npm run test:integration # Run real PostgreSQL integration tests (9 suites) against .env.test
   ```

> **Note:** Phase 9B security & lifecycle hardening is complete locally (see [docs/phase9b-migration-guide.md](./docs/phase9b-migration-guide.md) and [docs/encounter-lifecycle-contract.md](./docs/encounter-lifecycle-contract.md)). **Security Notice:** `KAN-6` routes (`/payers/*`, `/validation/*`) remain unauthenticated (`F-03`); do not expose the combined backend publicly until secured. All medical data used in this project must be synthetic or de-identified.
