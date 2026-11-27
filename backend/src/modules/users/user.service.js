const HTTP_STATUS = require('../../constants/httpStatus');
const { ROLES } = require('../../constants/roles');
const ApiError = require('../../utils/ApiError');
const { prisma } = require('../../config/prisma');
const { AuditService, AUDIT_ACTIONS, AUDIT_ENTITIES } = require('../audit');
const { hashPassword, verifyPassword } = require('../auth/password.util');
const userRepository = require('./user.repository');

const BUSINESS_ROLE_SET = new Set(Object.values(ROLES));
const SERIALIZABLE_TX = {
  isolationLevel: 'Serializable',
  maxWait: 10000,
  timeout: 15000,
};

function formatUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    roleId: user.roleId,
    role: user.role ? user.role.name : null,
    isActive: user.isActive,
    accountStatus: user.accountStatus,
    createdAt: user.createdAt,
  };
}

async function resolveBusinessRole({ role, roleId }, dbClient) {
  const roleRecord = await userRepository.findRoleByNameOrId({ role, roleId }, dbClient);
  if (!roleRecord || !BUSINESS_ROLE_SET.has(roleRecord.name)) {
    throw new ApiError(
      HTTP_STATUS.BAD_REQUEST,
      'INVALID_ROLE',
      'Specified role is not a valid business role'
    );
  }
  return roleRecord;
}

async function runSerializableTransaction(fn) {
  try {
    return await prisma.$transaction(fn, SERIALIZABLE_TX);
  } catch (err) {
    if (err && err.code === 'P2034') {
      throw new ApiError(
        HTTP_STATUS.CONFLICT,
        'CONCURRENT_MODIFICATION',
        'Concurrent user modification detected, please retry'
      );
    }
    throw err;
  }
}

class UserService {
  static async listUsers(query = {}) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;

    const { items, total } = await userRepository.findUsers(
      {
        search: query.search,
        role: query.role,
        roleId: query.roleId !== undefined ? Number(query.roleId) : undefined,
        accountStatus: query.accountStatus,
        isActive: query.isActive,
      },
      { page, limit }
    );

    return {
      items: items.map(formatUser),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 0,
      },
    };
  }

  static async listPendingUsers(query = {}) {
    return UserService.listUsers({
      ...query,
      accountStatus: 'PENDING',
    });
  }

  static async getUserById(id) {
    const user = await userRepository.findUserById(id);
    if (!user) {
      throw new ApiError(HTTP_STATUS.NOT_FOUND, 'USER_NOT_FOUND', 'User not found');
    }
    return formatUser(user);
  }

  static async listRoles() {
    const roles = await userRepository.findAllRoles();
    return roles.filter((r) => BUSINESS_ROLE_SET.has(r.name));
  }

  static async approveUser(targetUserId, roleInput, actor) {
    return runSerializableTransaction(async (tx) => {
      const target = await userRepository.findUserById(targetUserId, tx);
      if (!target) {
        throw new ApiError(HTTP_STATUS.NOT_FOUND, 'USER_NOT_FOUND', 'User not found');
      }

      if (target.accountStatus !== 'PENDING') {
        throw new ApiError(
          HTTP_STATUS.BAD_REQUEST,
          'INVALID_ACCOUNT_TRANSITION',
          `Cannot approve user with accountStatus ${target.accountStatus}`
        );
      }

      const roleRecord = await resolveBusinessRole(roleInput, tx);

      const updated = await userRepository.updateUserById(
        targetUserId,
        {
          accountStatus: 'APPROVED',
          roleId: roleRecord.id,
        },
        tx
      );

      await AuditService.log(
        {
          userId: actor.userId,
          action: AUDIT_ACTIONS.USER_ACCOUNT_APPROVED,
          entity: AUDIT_ENTITIES.USER,
          entityId: updated.id,
          ipAddress: actor.ipAddress,
        },
        { tx }
      );

      await AuditService.log(
        {
          userId: actor.userId,
          action: AUDIT_ACTIONS.USER_ROLE_ASSIGNED,
          entity: AUDIT_ENTITIES.USER,
          entityId: updated.id,
          ipAddress: actor.ipAddress,
        },
        { tx }
      );

      return formatUser(updated);
    });
  }

  static async rejectUser(targetUserId, actor) {
    if (targetUserId === actor.userId) {
      throw new ApiError(
        HTTP_STATUS.BAD_REQUEST,
        'SELF_REJECTION_FORBIDDEN',
        'Administrators cannot reject their own account'
      );
    }

    return runSerializableTransaction(async (tx) => {
      const target = await userRepository.findUserById(targetUserId, tx);
      if (!target) {
        throw new ApiError(HTTP_STATUS.NOT_FOUND, 'USER_NOT_FOUND', 'User not found');
      }

      if (target.accountStatus !== 'PENDING') {
        throw new ApiError(
          HTTP_STATUS.BAD_REQUEST,
          'INVALID_ACCOUNT_TRANSITION',
          `Cannot reject user with accountStatus ${target.accountStatus}`
        );
      }

      const updated = await userRepository.updateUserById(
        targetUserId,
        {
          accountStatus: 'REJECTED',
          roleId: null,
        },
        tx
      );

      await AuditService.log(
        {
          userId: actor.userId,
          action: AUDIT_ACTIONS.USER_ACCOUNT_REJECTED,
          entity: AUDIT_ENTITIES.USER,
          entityId: updated.id,
          ipAddress: actor.ipAddress,
        },
        { tx }
      );

      return formatUser(updated);
    });
  }

  static async assignRole(targetUserId, roleInput, actor) {
    return runSerializableTransaction(async (tx) => {
      const target = await userRepository.findUserById(targetUserId, tx);
      if (!target) {
        throw new ApiError(HTTP_STATUS.NOT_FOUND, 'USER_NOT_FOUND', 'User not found');
      }

      if (target.accountStatus !== 'APPROVED') {
        throw new ApiError(
          HTTP_STATUS.BAD_REQUEST,
          'INVALID_ACCOUNT_TRANSITION',
          'Only APPROVED accounts can be assigned or reassigned a business role'
        );
      }

      const newRole = await resolveBusinessRole(roleInput, tx);
      const currentRoleName = target.role ? target.role.name : null;

      if (targetUserId === actor.userId && currentRoleName === ROLES.ADMIN && newRole.name !== ROLES.ADMIN) {
        throw new ApiError(
          HTTP_STATUS.BAD_REQUEST,
          'SELF_DEMOTION_FORBIDDEN',
          'Administrators cannot demote their own account'
        );
      }

      if (
        currentRoleName === ROLES.ADMIN &&
        newRole.name !== ROLES.ADMIN &&
        target.isActive
      ) {
        const activeAdmins = await userRepository.countActiveApprovedAdmins(tx);
        if (activeAdmins <= 1) {
          throw new ApiError(
            HTTP_STATUS.CONFLICT,
            'LAST_ADMIN_PROTECTION',
            'Cannot demote the last active approved administrator'
          );
        }
      }

      const updated = await userRepository.updateUserById(
        targetUserId,
        { roleId: newRole.id },
        tx
      );

      await AuditService.log(
        {
          userId: actor.userId,
          action: AUDIT_ACTIONS.USER_ROLE_ASSIGNED,
          entity: AUDIT_ENTITIES.USER,
          entityId: updated.id,
          ipAddress: actor.ipAddress,
        },
        { tx }
      );

      return formatUser(updated);
    });
  }

  static async updateStatus(targetUserId, { isActive }, actor) {
    if (targetUserId === actor.userId && isActive === false) {
      throw new ApiError(
        HTTP_STATUS.BAD_REQUEST,
        'SELF_DISABLE_FORBIDDEN',
        'Administrators cannot disable their own account'
      );
    }

    return runSerializableTransaction(async (tx) => {
      const target = await userRepository.findUserById(targetUserId, tx);
      if (!target) {
        throw new ApiError(HTTP_STATUS.NOT_FOUND, 'USER_NOT_FOUND', 'User not found');
      }

      const currentRoleName = target.role ? target.role.name : null;
      if (
        isActive === false &&
        target.isActive &&
        target.accountStatus === 'APPROVED' &&
        currentRoleName === ROLES.ADMIN
      ) {
        const activeAdmins = await userRepository.countActiveApprovedAdmins(tx);
        if (activeAdmins <= 1) {
          throw new ApiError(
            HTTP_STATUS.CONFLICT,
            'LAST_ADMIN_PROTECTION',
            'Cannot disable the last active approved administrator'
          );
        }
      }

      const updated = await userRepository.updateUserById(
        targetUserId,
        { isActive },
        tx
      );

      await AuditService.log(
        {
          userId: actor.userId,
          action: isActive
            ? AUDIT_ACTIONS.USER_ACCOUNT_ACTIVATED
            : AUDIT_ACTIONS.USER_ACCOUNT_DISABLED,
          entity: AUDIT_ENTITIES.USER,
          entityId: updated.id,
          ipAddress: actor.ipAddress,
        },
        { tx }
      );

      return formatUser(updated);
    });
  }

  static async updateProfile(userId, payload, actor) {
    const existing = await userRepository.findUserById(userId);
    if (!existing) {
      throw new ApiError(HTTP_STATUS.NOT_FOUND, 'USER_NOT_FOUND', 'User not found');
    }

    if (payload.email && payload.email !== existing.email) {
      const duplicate = await userRepository.findUserByEmail(payload.email);
      if (duplicate && duplicate.id !== userId) {
        throw new ApiError(
          HTTP_STATUS.CONFLICT,
          'EMAIL_ALREADY_IN_USE',
          'An account with this email already exists'
        );
      }
    }

    try {
      return await prisma.$transaction(async (tx) => {
        const updated = await userRepository.updateUserById(
          userId,
          {
            ...(payload.name !== undefined ? { name: payload.name } : {}),
            ...(payload.email !== undefined ? { email: payload.email } : {}),
          },
          tx
        );

        await AuditService.log(
          {
            userId: actor.userId,
            action: AUDIT_ACTIONS.USER_PROFILE_UPDATED,
            entity: AUDIT_ENTITIES.USER,
            entityId: updated.id,
            ipAddress: actor.ipAddress,
          },
          { tx }
        );

        return formatUser(updated);
      });
    } catch (err) {
      if (err && err.code === 'P2002') {
        throw new ApiError(
          HTTP_STATUS.CONFLICT,
          'EMAIL_ALREADY_IN_USE',
          'An account with this email already exists'
        );
      }
      throw err;
    }
  }

  static async changePassword(userId, { currentPassword, newPassword }, actor) {
    const user = await userRepository.findUserWithPasswordById(userId);
    if (!user) {
      throw new ApiError(HTTP_STATUS.NOT_FOUND, 'USER_NOT_FOUND', 'User not found');
    }

    const matches = await verifyPassword(currentPassword, user.passwordHash);
    if (!matches) {
      throw new ApiError(
        HTTP_STATUS.UNAUTHORIZED,
        'INVALID_CURRENT_PASSWORD',
        'Current password is incorrect'
      );
    }

    const newHash = await hashPassword(newPassword);

    await prisma.$transaction(async (tx) => {
      await userRepository.updateUserById(
        userId,
        { passwordHash: newHash },
        tx
      );

      await AuditService.log(
        {
          userId: actor.userId,
          action: AUDIT_ACTIONS.USER_PASSWORD_CHANGED,
          entity: AUDIT_ENTITIES.USER,
          entityId: userId,
          ipAddress: actor.ipAddress,
        },
        { tx }
      );
    });

    return { passwordChanged: true };
  }
}

module.exports = UserService;
