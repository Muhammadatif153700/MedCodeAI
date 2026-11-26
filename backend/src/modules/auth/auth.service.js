const HTTP_STATUS = require('../../constants/httpStatus');
const { ROLES } = require('../../constants/roles');
const ApiError = require('../../utils/ApiError');
const { prisma } = require('../../config/prisma');
const { AuditService, AUDIT_ACTIONS, AUDIT_ENTITIES } = require('../audit');
const {
  DUMMY_PASSWORD_HASH,
  hashPassword,
  verifyPassword,
} = require('./password.util');
const { signAccessToken } = require('./jwt.util');
const authRepository = require('./auth.repository');

const BUSINESS_ROLE_SET = new Set(Object.values(ROLES));

function sanitizeAuthUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    roleId: user.roleId,
    role: user.role ? user.role.name : null,
    accountStatus: user.accountStatus,
    isActive: user.isActive,
    createdAt: user.createdAt,
  };
}

class AuthService {
  /**
   * Public user registration (KAN-12 / UC-01).
   * Creates a PENDING account with roleId = null and logs USER_REGISTERED atomically.
   */
  static async register({ name, email, password, ipAddress = null }) {
    const existing = await authRepository.findUserByEmailForLogin(email);
    if (existing) {
      throw new ApiError(
        HTTP_STATUS.CONFLICT,
        'EMAIL_ALREADY_REGISTERED',
        'An account with this email already exists'
      );
    }

    const passwordHash = await hashPassword(password);

    try {
      const createdUser = await prisma.$transaction(async (tx) => {
        const user = await authRepository.createPendingUser(
          { name, email, passwordHash },
          tx
        );

        await AuditService.log(
          {
            userId: user.id,
            action: AUDIT_ACTIONS.USER_REGISTERED,
            entity: AUDIT_ENTITIES.USER,
            entityId: user.id,
            ipAddress,
          },
          { tx }
        );

        return user;
      });

      return sanitizeAuthUser(createdUser);
    } catch (err) {
      if (err && err.code === 'P2002') {
        throw new ApiError(
          HTTP_STATUS.CONFLICT,
          'EMAIL_ALREADY_REGISTERED',
          'An account with this email already exists'
        );
      }
      throw err;
    }
  }

  /**
   * Authenticates an approved active user and issues a signed JWT (KAN-13 / UC-02).
   */
  static async login({ email, password, ipAddress = null }) {
    const user = await authRepository.findUserByEmailForLogin(email);
    const hashToCompare = user ? user.passwordHash : DUMMY_PASSWORD_HASH;
    const passwordMatches = await verifyPassword(password, hashToCompare);

    if (!user) {
      // audit_logs.user_id is non-nullable in schema.prisma; log safe non-identifying security event.
      console.warn('[SECURITY] Failed login attempt for unrecognized account');
      throw new ApiError(
        HTTP_STATUS.UNAUTHORIZED,
        'INVALID_CREDENTIALS',
        'Invalid email or password'
      );
    }

    if (!passwordMatches) {
      await AuditService.log({
        userId: user.id,
        action: AUDIT_ACTIONS.USER_LOGIN_FAILED,
        entity: AUDIT_ENTITIES.USER,
        entityId: user.id,
        ipAddress,
      });

      throw new ApiError(
        HTTP_STATUS.UNAUTHORIZED,
        'INVALID_CREDENTIALS',
        'Invalid email or password'
      );
    }

    if (!user.isActive) {
      throw new ApiError(
        HTTP_STATUS.FORBIDDEN,
        'ACCOUNT_DISABLED',
        'Account is disabled'
      );
    }

    if (user.accountStatus === 'PENDING') {
      throw new ApiError(
        HTTP_STATUS.FORBIDDEN,
        'ACCOUNT_PENDING_APPROVAL',
        'Account is pending administrator approval'
      );
    }

    if (user.accountStatus === 'REJECTED') {
      throw new ApiError(
        HTTP_STATUS.FORBIDDEN,
        'ACCOUNT_REJECTED',
        'Account registration was rejected'
      );
    }

    if (
      user.accountStatus !== 'APPROVED' ||
      !user.role ||
      !BUSINESS_ROLE_SET.has(user.role.name)
    ) {
      throw new ApiError(
        HTTP_STATUS.FORBIDDEN,
        'ROLE_NOT_ASSIGNED',
        'Account does not have an assigned business role'
      );
    }

    const token = signAccessToken({ userId: user.id });

    await AuditService.log({
      userId: user.id,
      action: AUDIT_ACTIONS.USER_LOGIN_SUCCESS,
      entity: AUDIT_ENTITIES.USER,
      entityId: user.id,
      ipAddress,
    });

    return {
      token,
      user: sanitizeAuthUser(user),
    };
  }
}

module.exports = AuthService;
