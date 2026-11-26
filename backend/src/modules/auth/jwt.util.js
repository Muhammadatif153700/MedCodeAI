const jwt = require('jsonwebtoken');
const { env, assertJwtConfigured } = require('../../config/env');

const JWT_ALGORITHM = 'HS256';

/**
 * Signs an access JWT with an explicit algorithm, subject, issuer, audience, and expiration.
 * Never embeds passwords, hashes, or unnecessary personal data.
 * @param {{ userId: number }} params
 */
function signAccessToken({ userId }) {
  assertJwtConfigured(env);

  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error('Invalid userId for JWT subject');
  }

  return jwt.sign({}, env.JWT_SECRET, {
    algorithm: JWT_ALGORITHM,
    subject: String(userId),
    expiresIn: env.JWT_EXPIRES_IN,
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
  });
}

/**
 * Verifies a JWT signature, algorithm, expiration, issuer, audience, and subject.
 * @param {string} token
 * @returns {{ userId: number }}
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
  if (!Number.isInteger(userId) || userId <= 0 || String(userId) !== decoded.sub) {
    throw new Error('Invalid token subject');
  }

  return { userId };
}

module.exports = {
  JWT_ALGORITHM,
  signAccessToken,
  verifyAccessToken,
};
