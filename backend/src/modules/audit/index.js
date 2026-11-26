const AuditService = require('./audit.service');
const auditController = require('./audit.controller');
const {
  AUDIT_ACTIONS,
  AUDIT_ACTION_LIST,
  AUDIT_ENTITIES,
  AUDIT_ENTITY_LIST,
  CRITICAL_AUDIT_ACTIONS,
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} = require('./audit.constants');
const {
  sanitizeIpAddress,
  createAuditLogSchema,
  listAuditLogsQuerySchema,
} = require('./audit.schemas');

module.exports = {
  AuditService,
  auditController,
  AUDIT_ACTIONS,
  AUDIT_ACTION_LIST,
  AUDIT_ENTITIES,
  AUDIT_ENTITY_LIST,
  CRITICAL_AUDIT_ACTIONS,
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  sanitizeIpAddress,
  createAuditLogSchema,
  listAuditLogsQuerySchema,
};
