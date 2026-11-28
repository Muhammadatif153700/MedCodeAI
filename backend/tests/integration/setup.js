const path = require('path');
const { loadAndVerifyTestEnv } = require('../../src/config/testDbGuard');

process.env.NODE_ENV = 'test';

const envTestPath = path.resolve(__dirname, '../../.env.test');
loadAndVerifyTestEnv(envTestPath);

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error('Integration tests require JWT_SECRET of at least 32 characters in .env.test');
}
