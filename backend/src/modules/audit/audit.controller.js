const HTTP_STATUS = require('../../constants/httpStatus');
const asyncHandler = require('../../utils/asyncHandler');
const { sendSuccess } = require('../../utils/ApiResponse');
const AuditService = require('./audit.service');

/**
 * Planned Administrator-only audit log retrieval controller (FR-29 / UC-29).
 * Route GET /api/v1/audit-logs must remain unmounted until Phase 6 (KAN-13/KAN-14)
 * authentication and RBAC middleware are active.
 */
const listAuditLogs = asyncHandler(async (req, res) => {
  const { items, meta } = await AuditService.list(req.query);
  return sendSuccess(res, HTTP_STATUS.OK, items, meta);
});

module.exports = {
  listAuditLogs,
};
