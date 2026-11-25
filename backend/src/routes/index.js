const express = require('express');
const HTTP_STATUS = require('../constants/httpStatus');
const { sendSuccess } = require('../utils/ApiResponse');

const router = express.Router();

/**
 * GET /api/v1/health
 * Application liveness check (does not verify database connectivity in Phase 1).
 */
router.get('/health', (_req, res) => {
  return sendSuccess(res, HTTP_STATUS.OK, {
    service: 'MedCodeAI API',
    status: 'ok',
  });
});

module.exports = router;
