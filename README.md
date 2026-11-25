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
   npm run prisma:validate   # Validate prisma/schema.prisma
   npm run prisma:generate   # Generate Prisma Client
   npm run db:verify         # Run read-only SELECT 1 check on pooled & direct URLs
   ```
7. Run automated tests:
   ```bash
   npm test
   npm run test:coverage
   ```

> **Note:** Prisma 6 + Neon PostgreSQL connectivity is configured (`KAN-9`). Full database schema models, migrations, JWT authentication, and audit logging will be implemented in subsequent phases. All medical data used in this project must be synthetic or de-identified.
