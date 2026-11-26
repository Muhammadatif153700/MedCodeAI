const { prisma } = require('../../config/prisma');

const AUTH_USER_SELECT = Object.freeze({
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

async function findUserByEmailForLogin(email, dbClient = prisma) {
  return dbClient.user.findUnique({
    where: { email },
    select: {
      ...AUTH_USER_SELECT,
      passwordHash: true,
    },
  });
}

async function findUserByIdForAuth(id, dbClient = prisma) {
  return dbClient.user.findUnique({
    where: { id },
    select: AUTH_USER_SELECT,
  });
}

async function createPendingUser({ name, email, passwordHash }, dbClient = prisma) {
  return dbClient.user.create({
    data: {
      name,
      email,
      passwordHash,
      roleId: null,
      isActive: true,
      accountStatus: 'PENDING',
    },
    select: AUTH_USER_SELECT,
  });
}

module.exports = {
  AUTH_USER_SELECT,
  findUserByEmailForLogin,
  findUserByIdForAuth,
  createPendingUser,
};
