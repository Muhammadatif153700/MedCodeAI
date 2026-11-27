const http = require('http');
const app = require('./app');
const {
  env,
  assertDatabaseConfigured,
  assertJwtConfigured,
} = require('./config/env');
const { disconnectPrisma } = require('./config/prisma');

assertDatabaseConfigured(env);
assertJwtConfigured(env);

const server = http.createServer(app);

server.listen(env.PORT, () => {
  console.log(`MedCodeAI API listening on port ${env.PORT} (${env.NODE_ENV})`);
});

function shutdown(signal) {
  console.log(`${signal} received. Shutting down MedCodeAI API gracefully...`);
  server.close(async (err) => {
    if (err) {
      console.error('Error during server shutdown:', err);
      await disconnectPrisma();
      process.exit(1);
    }
    await disconnectPrisma();
    process.exit(0);
  });

  setTimeout(() => {
    console.error('Forced shutdown after timeout.');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
