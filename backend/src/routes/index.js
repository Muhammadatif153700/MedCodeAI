const express = require('express');
const HTTP_STATUS = require('../constants/httpStatus');
const ApiError = require('../utils/ApiError');
const { sendSuccess } = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');
const { checkDatabaseHealth } = require('../config/prisma');

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
  asyncHandler(async (_req, _res, next) => {
    try {
      await checkDatabaseHealth();
      return sendSuccess(_res, HTTP_STATUS.OK, {
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

module.exports = router;
