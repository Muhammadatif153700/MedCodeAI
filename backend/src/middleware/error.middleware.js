const { ZodError } = require('zod');
const ApiError = require('../utils/ApiError');
const HTTP_STATUS = require('../constants/httpStatus');
const { env } = require('../config/env');

/**
 * Handles requests that do not match any registered route.
 */
function notFoundHandler(req, _res, next) {
  next(
    new ApiError(
      HTTP_STATUS.NOT_FOUND,
      'ROUTE_NOT_FOUND',
      `Route not found: ${req.method} ${req.originalUrl}`
    )
  );
}

/**
 * Centralized Express error handler returning standardized JSON error responses.
 */
function errorHandler(err, _req, res, _next) {
  let statusCode = HTTP_STATUS.INTERNAL_SERVER_ERROR;
  let code = 'INTERNAL_SERVER_ERROR';
  let message = 'An unexpected error occurred';
  let details;

  if (err instanceof ApiError) {
    statusCode = err.statusCode;
    code = err.code;
    message = err.message;
    details = err.details;
  } else if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    statusCode = HTTP_STATUS.BAD_REQUEST;
    code = 'INVALID_JSON';
    message = 'Malformed JSON payload in request body';
  } else if (err instanceof ZodError) {
    statusCode = HTTP_STATUS.BAD_REQUEST;
    code = 'VALIDATION_ERROR';
    message = 'Request validation failed';
    details = err.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));
  } else if (err && err.type === 'entity.too.large') {
    statusCode = HTTP_STATUS.BAD_REQUEST;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'Request payload exceeds allowed size limit';
  }

  if (env.NODE_ENV === 'production' && statusCode >= 500) {
    message = 'An unexpected error occurred';
    details = undefined;
  }

  const errorPayload = {
    code,
    message,
  };

  if (details !== undefined) {
    errorPayload.details = details;
  }

  return res.status(statusCode).json({
    success: false,
    error: errorPayload,
  });
}

module.exports = {
  notFoundHandler,
  errorHandler,
};
