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
5. Verify the health endpoint:
   `GET http://localhost:5000/api/v1/health`
6. Run automated tests:
   ```bash
   npm test
   npm run test:coverage
   ```

> **Note:** Database models (Prisma + Neon PostgreSQL), JWT authentication, and audit logging will be implemented in subsequent phases. All medical data used in this project must be synthetic or de-identified.
