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
7. Run automated tests:
   ```bash
   npm test
   npm run test:coverage
   ```

> **Note:** Phase 8 (`KAN-15`–`KAN-16`) is complete—all 13 `KAN-4` backend foundation tasks (`KAN-8`–`KAN-20`) are implemented alongside the 26-table schema on `ali_dev`. See [docs/user-management-api.md](./docs/user-management-api.md), [docs/medical-entities-api.md](./docs/medical-entities-api.md), [docs/authentication-rbac.md](./docs/authentication-rbac.md), and [docs/team-handover.md](./docs/team-handover.md). All medical data used in this project must be synthetic or de-identified.
