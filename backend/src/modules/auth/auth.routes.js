const express = require('express');
const rateLimit = require('express-rate-limit');
const { env } = require('../../config/env');
const HTTP_STATUS = require('../../constants/httpStatus');
const ApiError = require('../../utils/ApiError');
const validate = require('../../middleware/validate.middleware');
const { authenticate } = require('../../middleware/auth.middleware');
const { registerSchema, loginSchema } = require('./auth.schemas');
const authController = require('./auth.controller');

const router = express.Router();

function createAuthRateLimiter(options = {}) {
  return rateLimit({
    windowMs: options.windowMs ?? env.AUTH_RATE_LIMIT_WINDOW_MS,
    max: options.max ?? env.AUTH_RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    skip: options.skip ?? (() => env.NODE_ENV === 'test'),
    handler: (_req, _res, next) => {
      next(
        new ApiError(
          HTTP_STATUS.TOO_MANY_REQUESTS,
          'AUTH_RATE_LIMIT_EXCEEDED',
          'Too many authentication attempts, please try again later'
        )
      );
    },
  });
}

const authRateLimiter = createAuthRateLimiter();

router.post(
  '/register',
  authRateLimiter,
  validate(registerSchema),
  authController.register
);

router.post(
  '/login',
  authRateLimiter,
  validate(loginSchema),
  authController.login
);

router.get('/me', authenticate, authController.me);

module.exports = router;
module.exports.createAuthRateLimiter = createAuthRateLimiter;
