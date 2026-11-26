const { prisma } = require('../../config/prisma');

const SAFE_ACTOR_SELECT = Object.freeze({
  id: true,
  name: true,
  email: true,
  role: {
    select: {
      id: true,
      name: true,
    },
  },
});

/**
 * Persists an append-only audit log record.
 * Supports passing a Prisma transaction client (tx).
 * @param {{ userId: number, action: string, entity: string, entityId: number | null, ipAddress: string | null }} data
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} [dbClient=prisma]
 */
async function createAuditLog(data, dbClient = prisma) {
  return dbClient.auditLog.create({
    data: {
      userId: data.userId,
      action: data.action,
      entity: data.entity,
      entityId: data.entityId ?? null,
      ipAddress: data.ipAddress ?? null,
    },
  });
}

/**
 * Retrieves paginated audit logs with safe actor fields and deterministic newest-first ordering.
 * @param {{ userId?: number, action?: string, entity?: string, startDate?: Date, endDate?: Date }} filters
 * @param {{ page: number, limit: number }} pagination
 * @param {import('@prisma/client').PrismaClient} [dbClient=prisma]
 */
async function findAuditLogs(filters, pagination, dbClient = prisma) {
  const where = {};

  if (filters.userId !== undefined) {
    where.userId = filters.userId;
  }
  if (filters.action !== undefined) {
    where.action = filters.action;
  }
  if (filters.entity !== undefined) {
    where.entity = filters.entity;
  }
  if (filters.startDate !== undefined || filters.endDate !== undefined) {
    where.timestamp = {};
    if (filters.startDate !== undefined) {
      where.timestamp.gte = filters.startDate;
    }
    if (filters.endDate !== undefined) {
      where.timestamp.lte = filters.endDate;
    }
  }

  const skip = (pagination.page - 1) * pagination.limit;

  const [items, total] = await Promise.all([
    dbClient.auditLog.findMany({
      where,
      skip,
      take: pagination.limit,
      orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        userId: true,
        action: true,
        entity: true,
        entityId: true,
        ipAddress: true,
        timestamp: true,
        user: {
          select: SAFE_ACTOR_SELECT,
        },
      },
    }),
    dbClient.auditLog.count({ where }),
  ]);

  return { items, total };
}

module.exports = {
  SAFE_ACTOR_SELECT,
  createAuditLog,
  findAuditLogs,
};
