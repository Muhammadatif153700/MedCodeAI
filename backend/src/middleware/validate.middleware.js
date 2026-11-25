const { ZodError } = require('zod');
const ApiError = require('../utils/ApiError');
const HTTP_STATUS = require('../constants/httpStatus');

/**
 * Validates request body, query, and/or params using Zod schemas.
 * @param {{ body?: import('zod').ZodTypeAny, query?: import('zod').ZodTypeAny, params?: import('zod').ZodTypeAny }} schemas
 */
function validate(schemas = {}) {
  return function validateRequest(req, _res, next) {
    try {
      const validationErrors = [];

      for (const target of ['params', 'query', 'body']) {
        const schema = schemas[target];
        if (!schema) continue;

        const result = schema.safeParse(req[target]);
        if (!result.success) {
          for (const issue of result.error.issues) {
            validationErrors.push({
              location: target,
              field: issue.path.join('.') || target,
              message: issue.message,
            });
          }
        } else if (target === 'body' || target === 'params') {
          req[target] = result.data;
        }
      }

      if (validationErrors.length > 0) {
        return next(
          new ApiError(
            HTTP_STATUS.BAD_REQUEST,
            'VALIDATION_ERROR',
            'Request validation failed',
            validationErrors
          )
        );
      }

      return next();
    } catch (err) {
      if (err instanceof ZodError) {
        return next(
          new ApiError(
            HTTP_STATUS.BAD_REQUEST,
            'VALIDATION_ERROR',
            'Request validation failed'
          )
        );
      }
      return next(err);
    }
  };
}

module.exports = validate;
