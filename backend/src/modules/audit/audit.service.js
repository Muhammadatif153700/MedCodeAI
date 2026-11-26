const HTTP_STATUS = require('../../constants/httpStatus');
const ApiError = require('../../utils/ApiError');
const { prisma } = require('../../config/prisma');
const { CRITICAL_AUDIT_ACTIONS } = require('./audit.constants');
const { createAuditLogSchema, listAuditLogsQuerySchema } = require('./audit.schemas');
const auditRepository = require('./audit.repository');

/**
 * Shared append-only Audit Logging Service (KAN-20).
 */
class AuditService {
  /**
   * Validates and persists an audit log entry.
   * Accepts an optional Prisma transaction client via options.tx.
   * Security-sensitive actions always propagate persistence errors.
   *
   * @param {{ userId: number, action: string, entity: string, entityId?: number | null, ipAddress?: string | null }} payload
   * @param {{ tx?: import('@prisma/client').Prisma.TransactionClient, bestEffort?: boolean }} [options={}]
   */
  static async log(payload, options = {}) {
    const parsed = createAuditLogSchema.safeParse(payload);
    if (!parsed.success) {
      const details = parsed.error.issues.map((issue) => ({
        field: issue.path.join('.') || 'payload',
        message: issue.message,
      }));
      throw new ApiError(
        HTTP_STATUS.BAD_REQUEST,
        'INVALID_AUDIT_INPUT',
        'Invalid audit log payload',
        details
      );
    }

    const dbClient = options.tx || prisma;
    const isCritical = CRITICAL_AUDIT_ACTIONS.has(parsed.data.action);

    try {
      return await auditRepository.createAuditLog(parsed.data, dbClient);
    } catch (_err) {
      if (options.bestEffort === true && !isCritical) {
        return null;
      }
      throw new ApiError(
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        'AUDIT_LOG_FAILED',
        'Unable to persist audit log entry'
      );
    }
  }

  /**
   * Retrieves paginated, filtered audit logs for Administrator review (FR-29 / UC-29).
   * @param {Record<string, unknown>} [rawQuery={}]
   */
  static async list(rawQuery = {}) {
    const parsed = listAuditLogsQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      const details = parsed.error.issues.map((issue) => ({
        field: issue.path.join('.') || 'query',
        message: issue.message,
      }));
      throw new ApiError(
        HTTP_STATUS.BAD_REQUEST,
        'INVALID_AUDIT_QUERY',
        'Invalid audit log filter parameters',
        details
      );
    }

    const { page, limit, userId, action, entity, startDate, endDate } = parsed.data;
    const { items, total } = await auditRepository.findAuditLogs(
      { userId, action, entity, startDate, endDate },
      { page, limit },
      prisma
    );

    const totalPages = Math.ceil(total / limit) || 0;

    return {
      items,
      meta: {
        page,
        limit,
        total,
        totalPages,
      },
    };
  }
}

module.exports = AuditService;
