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
 * Administrator-only Audit Log retrieval (FR-29 / UC-29 / KAN-20)
 */
router.get(
  '/audit-logs',
  authenticate,
  authorize(ROLES.ADMIN),
  auditController.listAuditLogs
);

module.exports = router;
