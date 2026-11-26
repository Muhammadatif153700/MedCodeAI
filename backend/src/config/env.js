const path = require('path');
const { z } = require('zod');
const dotenv = require('dotenv');

dotenv.config({
  path: path.resolve(__dirname, '../../.env'),
  quiet: true,
});

const MIN_JWT_SECRET_LENGTH = 32;

function isValidPostgresUrl(value) {
  if (!value) return true;
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === 'postgresql:' || parsed.protocol === 'postgres:') &&
      Boolean(parsed.hostname)
    );
  } catch {
    return false;
  }
}

const postgresUrlSchema = z
  .string()
  .optional()
  .default('')
  .refine(isValidPostgresUrl, {
    message: 'Must be a valid PostgreSQL connection URL (postgres:// or postgresql://)',
  });

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce
      .number({ invalid_type_error: 'PORT must be a number' })
      .int()
      .min(1)
      .max(65535)
      .default(5000),
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:3000')
      .transform((val) =>
        val
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean)
      ),
    DATABASE_URL: postgresUrlSchema,
    DIRECT_URL: postgresUrlSchema,
    JWT_SECRET: z.string().optional().default(''),
    JWT_EXPIRES_IN: z.string().trim().min(1).optional().default('1h'),
    JWT_ISSUER: z.string().trim().min(1).optional().default('medcodeai-api'),
    JWT_AUDIENCE: z.string().trim().min(1).optional().default('medcodeai-client'),
    AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900000),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  })
  .superRefine((data, ctx) => {
    if (data.NODE_ENV === 'production') {
      if (!data.JWT_SECRET || data.JWT_SECRET.length < MIN_JWT_SECRET_LENGTH) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_SECRET'],
          message: `JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters in production`,
        });
      }
      if (!data.DATABASE_URL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['DATABASE_URL'],
          message: 'DATABASE_URL is required in production',
        });
      }
    }
  });

/**
 * Validates environment variables against the Zod schema.
 * Never logs connection strings or credentials.
 * @param {Record<string, string | undefined>} rawEnv
 */
function validateEnv(rawEnv = process.env) {
  const parsed = envSchema.safeParse(rawEnv);

  if (!parsed.success) {
    const details = parsed.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`
    );
    throw new Error(`Invalid environment configuration: ${details.join('; ')}`);
  }

  return Object.freeze(parsed.data);
}

const env = validateEnv(process.env);

/**
 * Ensures DATABASE_URL is configured before database-dependent operations execute.
 * @param {Record<string, unknown>} [targetEnv=env]
 */
function assertDatabaseConfigured(targetEnv = env) {
  if (!targetEnv.DATABASE_URL) {
    throw new Error('Database configuration missing: DATABASE_URL is not set');
  }
}

/**
 * Ensures JWT_SECRET is configured with sufficient length before signing/verifying tokens.
 * @param {Record<string, unknown>} [targetEnv=env]
 */
function assertJwtConfigured(targetEnv = env) {
  if (!targetEnv.JWT_SECRET || String(targetEnv.JWT_SECRET).length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(
      `JWT configuration invalid: JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters`
    );
  }
}

module.exports = {
  env,
  validateEnv,
  assertDatabaseConfigured,
  assertJwtConfigured,
  isValidPostgresUrl,
  MIN_JWT_SECRET_LENGTH,
  envSchema,
};
