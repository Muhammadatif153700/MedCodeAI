const path = require('path');
const { z } = require('zod');
const dotenv = require('dotenv');

dotenv.config({
  path: path.resolve(__dirname, '../../.env'),
  quiet: true,
});

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

const envSchema = z.object({
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
  JWT_EXPIRES_IN: z.string().optional().default('1h'),
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

module.exports = {
  env,
  validateEnv,
  assertDatabaseConfigured,
  isValidPostgresUrl,
  envSchema,
};
