const { z } = require('zod');
const { ROLES } = require('../../constants/roles');
const { MAX_PASSWORD_BYTES } = require('../auth/password.util');

const BUSINESS_ROLE_VALUES = Object.values(ROLES);
const ACCOUNT_STATUS_VALUES = ['PENDING', 'APPROVED', 'REJECTED'];

const idParamSchema = z.object({
  id: z.coerce
    .number({ invalid_type_error: 'User id must be a positive integer' })
    .int('User id must be an integer')
    .positive('User id must be a positive integer'),
});

const roleAssignmentBody = z
  .object({
    role: z.enum(BUSINESS_ROLE_VALUES).optional(),
    roleId: z.number().int().positive().optional(),
  })
  .strict()
  .refine((data) => Boolean(data.role) !== Boolean(data.roleId), {
    message: 'Provide exactly one of role or roleId',
  });

const listUsersSchema = {
  query: z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
      search: z.string().trim().max(120).optional(),
      role: z.enum(BUSINESS_ROLE_VALUES).optional(),
      roleId: z.coerce.number().int().positive().optional(),
      accountStatus: z.enum(ACCOUNT_STATUS_VALUES).optional(),
      isActive: z
        .enum(['true', 'false'])
        .transform((val) => val === 'true')
        .optional(),
    })
    .strict(),
};

const userIdSchema = {
  params: idParamSchema,
};

const approveUserSchema = {
  params: idParamSchema,
  body: roleAssignmentBody,
};

const rejectUserSchema = {
  params: idParamSchema,
};

const assignUserRoleSchema = {
  params: idParamSchema,
  body: roleAssignmentBody,
};

const updateUserStatusSchema = {
  params: idParamSchema,
  body: z
    .object({
      isActive: z.boolean({ required_error: 'isActive boolean is required' }),
    })
    .strict(),
};

const updateProfileSchema = {
  body: z
    .object({
      name: z
        .string()
        .trim()
        .min(2, 'Name must be at least 2 characters')
        .max(100, 'Name must not exceed 100 characters')
        .optional(),
      email: z
        .string()
        .trim()
        .max(255, 'Email must not exceed 255 characters')
        .email('Invalid email address')
        .transform((val) => val.toLowerCase())
        .optional(),
    })
    .strict()
    .refine((data) => Object.keys(data).length > 0, {
      message: 'At least one profile field (name or email) must be provided',
    }),
};

const changePasswordSchema = {
  body: z
    .object({
      currentPassword: z
        .string({ required_error: 'currentPassword is required' })
        .min(1, 'currentPassword is required')
        .refine((val) => Buffer.byteLength(val, 'utf8') <= MAX_PASSWORD_BYTES, {
          message: `Password must not exceed ${MAX_PASSWORD_BYTES} UTF-8 bytes`,
        }),
      newPassword: z
        .string({ required_error: 'newPassword is required' })
        .min(8, 'newPassword must be at least 8 characters')
        .max(72, 'newPassword must not exceed 72 characters')
        .refine((val) => Buffer.byteLength(val, 'utf8') <= MAX_PASSWORD_BYTES, {
          message: `newPassword must not exceed ${MAX_PASSWORD_BYTES} UTF-8 bytes`,
        }),
    })
    .strict(),
};

module.exports = {
  listUsersSchema,
  userIdSchema,
  approveUserSchema,
  rejectUserSchema,
  assignUserRoleSchema,
  updateUserStatusSchema,
  updateProfileSchema,
  changePasswordSchema,
};
