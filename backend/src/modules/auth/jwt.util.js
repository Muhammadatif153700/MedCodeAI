const jwt = require('jsonwebtoken');
const { env, assertJwtConfigured } = require('../../config/env');

const JWT_ALGORITHM = 'HS256';

/**
 * Signs an access JWT with an explicit algorithm, subject, tokenVersion (tv),
 * issuer, audience, and expiration.
 * @param {{ userId: number, tokenVersion?: number }} params
 */
function signAccessToken({ userId, tokenVersion = 0 }) {
  assertJwtConfigured(env);

  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new Error('Invalid userId for JWT subject');
  }
  if (!Number.isSafeInteger(tokenVersion) || tokenVersion < 0) {
    throw new Error('Invalid tokenVersion for JWT');
  }

  return jwt.sign({ tv: tokenVersion }, env.JWT_SECRET, {
    algorithm: JWT_ALGORITHM,
    subject: String(userId),
    expiresIn: env.JWT_EXPIRES_IN,
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
  });
}

/**
 * Verifies a JWT signature, algorithm, expiration, issuer, audience, subject, and tv claim.
 * Rejects legacy tokens missing the required integer tokenVersion claim.
 * @param {string} token
 * @returns {{ userId: number, tokenVersion: number }}
 */
function verifyAccessToken(token) {
  assertJwtConfigured(env);

  const decoded = jwt.verify(token, env.JWT_SECRET, {
    algorithms: [JWT_ALGORITHM],
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
  });

  if (!decoded || typeof decoded !== 'object' || typeof decoded.sub !== 'string') {
    throw new Error('Invalid token subject');
  }

  const userId = Number(decoded.sub);
  if (!Number.isSafeInteger(userId) || userId <= 0 || String(userId) !== decoded.sub) {
    throw new Error('Invalid token subject');
  }

  if (!Number.isSafeInteger(decoded.tv) || decoded.tv < 0) {
    throw new Error('Invalid or missing token version');
  }

  return { userId, tokenVersion: decoded.tv };
}

module.exports = {
  JWT_ALGORITHM,
  signAccessToken,
  verifyAccessToken,
};
