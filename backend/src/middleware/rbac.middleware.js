const HTTP_STATUS = require('../constants/httpStatus');
const { ROLES } = require('../constants/roles');
const ApiError = require('../utils/ApiError');

const BUSINESS_ROLE_SET = new Set(Object.values(ROLES));

/**
 * Role-based access control middleware (KAN-14).
 * Deny-by-default; requires authenticate() to run first.
 * @param {...string} allowedRoles
 */
function authorize(...allowedRoles) {
  if (allowedRoles.length === 0) {
    throw new Error('authorize() requires at least one allowed business role');
  }

  for (const role of allowedRoles) {
    if (!BUSINESS_ROLE_SET.has(role)) {
      throw new Error(`Invalid role configured in authorize(): ${role}`);
    }
  }

  const allowedSet = new Set(allowedRoles);

  return function rbacMiddleware(req, _res, next) {
    if (!req.user) {
      return next(
        new ApiError(
          HTTP_STATUS.UNAUTHORIZED,
          'AUTHENTICATION_REQUIRED',
          'Authentication is required'
        )
      );
    }

    if (req.user.accountStatus !== 'APPROVED') {
      return next(
        new ApiError(
          HTTP_STATUS.FORBIDDEN,
          'ACCOUNT_NOT_APPROVED',
          'Account is not approved for system access'
        )
      );
    }

    if (!req.user.role || !BUSINESS_ROLE_SET.has(req.user.role)) {
      return next(
        new ApiError(
          HTTP_STATUS.FORBIDDEN,
          'FORBIDDEN',
          'Invalid or unassigned user role'
        )
      );
    }

    if (!allowedSet.has(req.user.role)) {
      return next(
        new ApiError(
          HTTP_STATUS.FORBIDDEN,
          'FORBIDDEN',
          'You do not have permission to access this resource'
        )
      );
    }

    return next();
  };
}

module.exports = {
  authorize,
};
