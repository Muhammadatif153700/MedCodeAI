const { prisma } = require('../../config/prisma');

const SAFE_USER_SELECT = Object.freeze({
  id: true,
  name: true,
  email: true,
  roleId: true,
  isActive: true,
  accountStatus: true,
  createdAt: true,
  role: {
    select: {
      id: true,
      name: true,
    },
  },
});

async function findUsers(filters, pagination, dbClient = prisma) {
  const where = {};

  if (filters.accountStatus !== undefined) {
    where.accountStatus = filters.accountStatus;
  }
  if (filters.isActive !== undefined) {
    where.isActive = filters.isActive;
  }
  if (filters.roleId !== undefined) {
    where.roleId = filters.roleId;
  }
  if (filters.role !== undefined) {
    where.role = { name: filters.role };
  }
  if (filters.search) {
    where.OR = [
      { name: { contains: filters.search, mode: 'insensitive' } },
      { email: { contains: filters.search, mode: 'insensitive' } },
    ];
  }

  const skip = (pagination.page - 1) * pagination.limit;

  const [items, total] = await Promise.all([
    dbClient.user.findMany({
      where,
      skip,
      take: pagination.limit,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: SAFE_USER_SELECT,
    }),
    dbClient.user.count({ where }),
  ]);

  return { items, total };
}

async function findUserById(id, dbClient = prisma) {
  return dbClient.user.findUnique({
    where: { id },
    select: SAFE_USER_SELECT,
  });
}

async function findUserWithPasswordById(id, dbClient = prisma) {
  return dbClient.user.findUnique({
    where: { id },
    select: {
      ...SAFE_USER_SELECT,
      passwordHash: true,
    },
  });
}

async function findUserByEmail(email, dbClient = prisma) {
  return dbClient.user.findUnique({
    where: { email },
    select: { id: true, email: true },
  });
}

async function findRoleByNameOrId({ role, roleId }, dbClient = prisma) {
  if (roleId !== undefined) {
    return dbClient.role.findUnique({ where: { id: roleId } });
  }
  return dbClient.role.findUnique({ where: { name: role } });
}

async function findAllRoles(dbClient = prisma) {
  return dbClient.role.findMany({
    orderBy: [{ id: 'asc' }],
    select: { id: true, name: true },
  });
}

async function countActiveApprovedAdmins(dbClient = prisma) {
  return dbClient.user.count({
    where: {
      isActive: true,
      accountStatus: 'APPROVED',
      role: { name: 'ADMIN' },
    },
  });
}

async function updateUserById(id, data, dbClient = prisma) {
  return dbClient.user.update({
    where: { id },
    data,
    select: SAFE_USER_SELECT,
  });
}

module.exports = {
  SAFE_USER_SELECT,
  findUsers,
  findUserById,
  findUserWithPasswordById,
  findUserByEmail,
  findRoleByNameOrId,
  findAllRoles,
  countActiveApprovedAdmins,
  updateUserById,
};
