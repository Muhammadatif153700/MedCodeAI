const HTTP_STATUS = require('../constants/httpStatus');

/**
 * Sends a standardized success JSON response.
 * @param {import('express').Response} res
 * @param {number} [statusCode=200]
 * @param {unknown} [data={}]
 * @param {Record<string, unknown>} [meta]
 */
function sendSuccess(res, statusCode = HTTP_STATUS.OK, data = {}, meta = undefined) {
  const payload = {
    success: true,
    data,
  };

  if (meta !== undefined) {
    payload.meta = meta;
  }

  return res.status(statusCode).json(payload);
}

module.exports = {
  sendSuccess,
};
