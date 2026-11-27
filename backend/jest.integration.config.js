module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/integration/**/*.integration.test.js'],
  setupFiles: ['<rootDir>/tests/integration/setup.js'],
  testTimeout: 60000,
  verbose: true,
};
