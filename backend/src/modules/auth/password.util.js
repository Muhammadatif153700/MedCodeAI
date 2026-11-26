const bcrypt = require('bcryptjs');

const BCRYPT_WORK_FACTOR = 10;
const MAX_PASSWORD_BYTES = 72;

// Precomputed valid bcrypt hash used to equalize timing when an email does not exist.
const DUMMY_PASSWORD_HASH =
  '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

/**
 * Hashes a plaintext password using bcryptjs.
 * @param {string} plainText
 */
async function hashPassword(plainText) {
  if (Buffer.byteLength(plainText, 'utf8') > MAX_PASSWORD_BYTES) {
    throw new Error(`Password exceeds bcrypt ${MAX_PASSWORD_BYTES}-byte limit`);
  }
  return bcrypt.hash(plainText, BCRYPT_WORK_FACTOR);
}

/**
 * Verifies a plaintext password against a stored bcrypt hash.
 * @param {string} plainText
 * @param {string} passwordHash
 */
async function verifyPassword(plainText, passwordHash) {
  return bcrypt.compare(plainText, passwordHash);
}

module.exports = {
  BCRYPT_WORK_FACTOR,
  MAX_PASSWORD_BYTES,
  DUMMY_PASSWORD_HASH,
  hashPassword,
  verifyPassword,
};
