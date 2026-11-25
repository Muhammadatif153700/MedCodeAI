const { z } = require('zod');
const dotenv = require('dotenv');

dotenv.config({ quiet: true });

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
  DATABASE_URL: z.string().optional().default(''),
  DIRECT_URL: z.string().optional().default(''),
  JWT_SECRET: z.string().optional().default(''),
  JWT_EXPIRES_IN: z.string().optional().default('1h'),
});

/**
 * Validates environment variables against the Zod schema.
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

module.exports = {
  env,
  validateEnv,
  envSchema,
};
