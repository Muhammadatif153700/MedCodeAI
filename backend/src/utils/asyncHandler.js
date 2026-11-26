/**
 * Wraps async route handlers to forward rejected promises to Express error middleware.
 * @param {Function} fn
 */
function asyncHandler(fn) {
  return function wrappedHandler(req, res, next) {
    return Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;
