const AuthService = require('./auth.service');
const authController = require('./auth.controller');
const authRoutes = require('./auth.routes');
const { registerSchema, loginSchema } = require('./auth.schemas');
const { signAccessToken, verifyAccessToken, JWT_ALGORITHM } = require('./jwt.util');
const { hashPassword, verifyPassword } = require('./password.util');

module.exports = {
  AuthService,
  authController,
  authRoutes,
  registerSchema,
  loginSchema,
  signAccessToken,
  verifyAccessToken,
  JWT_ALGORITHM,
  hashPassword,
  verifyPassword,
};
