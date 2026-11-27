const HTTP_STATUS = require('../constants/httpStatus');
const { ROLES } = require('../constants/roles');
const ApiError = require('../utils/ApiError');
const { verifyAccessToken } = require('../modules/auth/jwt.util');
const { findUserByIdForAuth } = require('../modules/auth/auth.repository');

const BUSINESS_ROLE_SET = new Set(Object.values(ROLES));

/**
 * Verifies the Bearer JWT, reloads current user/role from PostgreSQL (fail-closed),
 * and attaches req.user for downstream handlers and RBAC middleware.
 */
async function authenticate(req, _res, next) {
  const authHeader = req.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(
      new ApiError(
        HTTP_STATUS.UNAUTHORIZED,
        'AUTHENTICATION_REQUIRED',
        'Authentication token is required'
      )
    );
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return next(
      new ApiError(
        HTTP_STATUS.UNAUTHORIZED,
        'AUTHENTICATION_REQUIRED',
        'Authentication token is required'
      )
    );
  }

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch (err) {
    if (err && err.name === 'TokenExpiredError') {
      return next(
        new ApiError(
          HTTP_STATUS.UNAUTHORIZED,
          'TOKEN_EXPIRED',
          'Authentication token has expired'
        )
      );
    }
    return next(
      new ApiError(
        HTTP_STATUS.UNAUTHORIZED,
        'INVALID_TOKEN',
        'Invalid authentication token'
      )
    );
  }

  let user;
  try {
    user = await findUserByIdForAuth(payload.userId);
  } catch (_dbErr) {
    return next(
      new ApiError(
        HTTP_STATUS.SERVICE_UNAVAILABLE,
        'AUTH_VERIFICATION_UNAVAILABLE',
        'Unable to verify authentication state'
      )
    );
  }

  if (!user) {
    return next(
      new ApiError(
        HTTP_STATUS.UNAUTHORIZED,
        'INVALID_TOKEN',
        'Authenticated user no longer exists'
      )
    );
  }

  if (!user.isActive) {
    return next(
      new ApiError(
        HTTP_STATUS.FORBIDDEN,
        'ACCOUNT_DISABLED',
        'Account is disabled'
      )
    );
  }

  if (user.accountStatus !== 'APPROVED') {
    return next(
      new ApiError(
        HTTP_STATUS.FORBIDDEN,
        'ACCOUNT_NOT_APPROVED',
        'Account is not approved for system access'
      )
    );
  }

  if (!user.role || !BUSINESS_ROLE_SET.has(user.role.name)) {
    return next(
      new ApiError(
        HTTP_STATUS.FORBIDDEN,
        'ROLE_NOT_ASSIGNED',
        'Account does not have a valid business role'
      )
    );
  }

  if ((user.tokenVersion ?? 0) !== payload.tokenVersion) {
    return next(
      new ApiError(
        HTTP_STATUS.UNAUTHORIZED,
        'TOKEN_REVOKED',
        'Authentication token has been revoked'
      )
    );
  }

  req.user = {
    id: user.id,
    name: user.name,
    email: user.email,
    roleId: user.roleId,
    role: user.role.name,
    accountStatus: user.accountStatus,
  };

  return next();
}

module.exports = {
  authenticate,
};
