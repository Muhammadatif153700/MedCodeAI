const express = require('express');
const HTTP_STATUS = require('../constants/httpStatus');
const { ROLES } = require('../constants/roles');
const ApiError = require('../utils/ApiError');
const { sendSuccess } = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');
const { checkDatabaseHealth } = require('../config/prisma');
const { authenticate } = require('../middleware/auth.middleware');
const { authorize } = require('../middleware/rbac.middleware');
const authRoutes = require('../modules/auth/auth.routes');
const { auditController } = require('../modules/audit');
const { userRoutes, profileRoutes, userController } = require('../modules/users');
const { patientRoutes } = require('../modules/patients');
const { providerRoutes } = require('../modules/providers');
const { encounterRoutes } = require('../modules/encounters');
const payersRoutes = require('../modules/payers/payers.routes');
const validationRoutes = require('../modules/validation/validation.routes');

const router = express.Router();

/**
 * GET /api/v1/health
 * Application liveness check (independent of database readiness).
 */
router.get('/health', (_req, res) => {
  return sendSuccess(res, HTTP_STATUS.OK, {
    service: 'MedCodeAI API',
    status: 'ok',
  });
});

/**
 * GET /api/v1/health/db
 * Database readiness check using a non-destructive read-only query.
 * Never exposes hostnames, credentials, or internal SQL errors.
 */
router.get(
  '/health/db',
  asyncHandler(async (_req, res, next) => {
    try {
      await checkDatabaseHealth();
      return sendSuccess(res, HTTP_STATUS.OK, {
        database: 'connected',
      });
    } catch (_err) {
      return next(
        new ApiError(
          HTTP_STATUS.SERVICE_UNAVAILABLE,
          'DATABASE_UNAVAILABLE',
          'Database service is currently unavailable'
        )
      );
    }
  })
);

/**
 * Authentication routes (KAN-12, KAN-13)
 */
router.use('/auth', authRoutes);

/**
 * Self-service Profile routes (KAN-16)
 */
router.use('/profile', profileRoutes);

/**
 * Administrator User & Role Management routes (KAN-15)
 */
router.use('/users', userRoutes);
router.get('/roles', authenticate, authorize(ROLES.ADMIN), userController.listRoles);

/**
 * Administrator-only Audit Log retrieval (FR-29 / UC-29 / KAN-20)
 */
router.get(
  '/audit-logs',
  authenticate,
  authorize(ROLES.ADMIN),
  auditController.listAuditLogs
);

/**
 * Core Medical Entity routes (KAN-17, KAN-18, KAN-19)
 */
router.use('/patients', patientRoutes);
router.use('/providers', providerRoutes);
router.use('/encounters', encounterRoutes);

/**
 * Payers & Validation routes (KAN-6)
 */
router.use('/payers', payersRoutes);
router.use('/validation', validationRoutes);

module.exports = router;
