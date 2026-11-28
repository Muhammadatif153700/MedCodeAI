const { PrismaClient } = require('@prisma/client');
const { env, assertDatabaseConfigured } = require('./env');

const globalForPrisma = globalThis;

function createPrismaClient() {
  return new PrismaClient({
    log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    transactionOptions: {
      maxWait: 10000,
      timeout: 30000,
    },
  });
}

/**
 * Shared PrismaClient singleton for all backend modules.
 */
const prisma = globalForPrisma.__medcodeaiPrisma || createPrismaClient();

if (env.NODE_ENV !== 'production') {
  globalForPrisma.__medcodeaiPrisma = prisma;
}

/**
 * Executes a non-destructive read-only readiness query against PostgreSQL.
 * @param {number} [timeoutMs=5000]
 */
async function checkDatabaseHealth(timeoutMs = 5000) {
  assertDatabaseConfigured(env);

  let timer;
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error('Database health check timed out'));
        }, timeoutMs);
        if (typeof timer.unref === 'function') {
          timer.unref();
        }
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

/**
 * Gracefully disconnects the shared PrismaClient instance.
 */
async function disconnectPrisma() {
  try {
    await prisma.$disconnect();
  } catch (err) {
    console.error('Error disconnecting Prisma client:', err.message);
  }
}

module.exports = {
  prisma,
  checkDatabaseHealth,
  disconnectPrisma,
};
