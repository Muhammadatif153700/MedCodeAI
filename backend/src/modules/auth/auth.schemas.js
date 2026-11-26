const { z } = require('zod');
const { MAX_PASSWORD_BYTES } = require('./password.util');

const emailSchema = z
  .string({ required_error: 'Email is required' })
  .trim()
  .min(1, 'Email is required')
  .max(255, 'Email must not exceed 255 characters')
  .email('Invalid email address')
  .transform((val) => val.toLowerCase());

const passwordSchema = z
  .string({ required_error: 'Password is required' })
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must not exceed 72 characters')
  .refine((val) => Buffer.byteLength(val, 'utf8') <= MAX_PASSWORD_BYTES, {
    message: `Password must not exceed ${MAX_PASSWORD_BYTES} UTF-8 bytes`,
  });

/**
 * Strict registration schema: rejects client-supplied roleId, role, accountStatus, or isActive.
 */
const registerSchema = {
  body: z
    .object({
      name: z
        .string({ required_error: 'Name is required' })
        .trim()
        .min(2, 'Name must be at least 2 characters')
        .max(100, 'Name must not exceed 100 characters'),
      email: emailSchema,
      password: passwordSchema,
    })
    .strict(),
};

const loginSchema = {
  body: z
    .object({
      email: emailSchema,
      password: z
        .string({ required_error: 'Password is required' })
        .min(1, 'Password is required')
        .refine((val) => Buffer.byteLength(val, 'utf8') <= MAX_PASSWORD_BYTES, {
          message: `Password must not exceed ${MAX_PASSWORD_BYTES} UTF-8 bytes`,
        }),
    })
    .strict(),
};

module.exports = {
  registerSchema,
  loginSchema,
};
