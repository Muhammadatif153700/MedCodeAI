const { z } = require('zod');
const {
  AUDIT_ACTION_LIST,
  AUDIT_ENTITY_LIST,
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} = require('./audit.constants');

const IPV4_OR_IPV6_REGEX = /^[0-9a-fA-F:.]{2,45}$/;

/**
 * Sanitizes an incoming IP address string so no headers, tokens, or query strings are stored.
 * Returns null if missing or invalid.
 * @param {unknown} rawIp
 * @returns {string | null}
 */
function sanitizeIpAddress(rawIp) {
  if (rawIp === undefined || rawIp === null || rawIp === '') {
    return null;
  }
  if (typeof rawIp !== 'string') {
    return null;
  }
  const firstHop = rawIp.split(',')[0].trim();
  const normalized = firstHop.startsWith('::ffff:')
    ? firstHop.slice(7)
    : firstHop;

  if (!IPV4_OR_IPV6_REGEX.test(normalized)) {
    return null;
  }
  return normalized;
}

/**
 * Strict schema for append-only AuditLog creation.
 * Uses .strict() to reject arbitrary unvalidated objects or sensitive metadata keys.
 */
const createAuditLogSchema = z
  .object({
    userId: z
      .number({
        required_error: 'userId is required',
        invalid_type_error: 'userId must be a positive integer',
      })
      .int('userId must be an integer')
      .positive('userId must be a positive integer'),
    action: z.enum(AUDIT_ACTION_LIST, {
      errorMap: () => ({ message: 'Invalid or unsupported audit action' }),
    }),
    entity: z.enum(AUDIT_ENTITY_LIST, {
      errorMap: () => ({ message: 'Invalid or unsupported audit entity' }),
    }),
    entityId: z
      .number({ invalid_type_error: 'entityId must be a positive integer' })
      .int('entityId must be an integer')
      .positive('entityId must be a positive integer')
      .nullable()
      .optional()
      .default(null),
    ipAddress: z
      .union([z.string(), z.null()])
      .optional()
      .transform((val) => sanitizeIpAddress(val)),
  })
  .strict();

const listAuditLogsQuerySchema = z
  .object({
    page: z.coerce
      .number({ invalid_type_error: 'page must be an integer' })
      .int('page must be an integer')
      .min(1, 'page must be at least 1')
      .default(DEFAULT_PAGE),
    limit: z.coerce
      .number({ invalid_type_error: 'limit must be an integer' })
      .int('limit must be an integer')
      .min(1, 'limit must be at least 1')
      .max(MAX_PAGE_SIZE, `limit must not exceed ${MAX_PAGE_SIZE}`)
      .default(DEFAULT_PAGE_SIZE),
    userId: z.coerce
      .number({ invalid_type_error: 'userId must be a positive integer' })
      .int('userId must be an integer')
      .positive('userId must be a positive integer')
      .optional(),
    action: z
      .enum(AUDIT_ACTION_LIST, {
        errorMap: () => ({ message: 'Invalid audit action filter' }),
      })
      .optional(),
    entity: z
      .enum(AUDIT_ENTITY_LIST, {
        errorMap: () => ({ message: 'Invalid audit entity filter' }),
      })
      .optional(),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
  })
  .strict()
  .refine(
    (data) => {
      if (data.startDate && data.endDate) {
        return data.startDate <= data.endDate;
      }
      return true;
    },
    {
      message: 'startDate must be less than or equal to endDate',
      path: ['startDate'],
    }
  );

module.exports = {
  sanitizeIpAddress,
  createAuditLogSchema,
  listAuditLogsQuerySchema,
};
