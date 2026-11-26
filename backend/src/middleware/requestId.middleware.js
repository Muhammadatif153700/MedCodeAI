const crypto = require('crypto');

const SAFE_REQUEST_ID_REGEX = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Assigns a unique request ID to each incoming request and exposes it via X-Request-Id.
 */
function requestIdMiddleware(req, res, next) {
  const incomingId = req.get('x-request-id');
  const requestId =
    incomingId && SAFE_REQUEST_ID_REGEX.test(incomingId)
      ? incomingId
      : crypto.randomUUID();

  req.id = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
}

module.exports = requestIdMiddleware;
