const { z } = require('zod');

const NPI_REGEX = /^\d{10}$/;

const idParamSchema = z.object({
  id: z.coerce
    .number({ invalid_type_error: 'Provider id must be a positive integer' })
    .int('Provider id must be an integer')
    .positive('Provider id must be a positive integer'),
});

const npiSchema = z
  .string({ required_error: 'npi is required' })
  .trim()
  .regex(NPI_REGEX, 'npi must be a 10-digit numeric string');

const createProviderSchema = {
  body: z
    .object({
      name: z
        .string({ required_error: 'name is required' })
        .trim()
        .min(2, 'name must be at least 2 characters')
        .max(120, 'name must not exceed 120 characters'),
      npi: npiSchema,
      specialty: z
        .string({ required_error: 'specialty is required' })
        .trim()
        .min(2, 'specialty must be at least 2 characters')
        .max(120, 'specialty must not exceed 120 characters'),
    })
    .strict(),
};

const updateProviderSchema = {
  params: idParamSchema,
  body: z
    .object({
      name: z
        .string()
        .trim()
        .min(2, 'name must be at least 2 characters')
        .max(120, 'name must not exceed 120 characters')
        .optional(),
      npi: npiSchema.optional(),
      specialty: z
        .string()
        .trim()
        .min(2, 'specialty must be at least 2 characters')
        .max(120, 'specialty must not exceed 120 characters')
        .optional(),
    })
    .strict()
    .refine((data) => Object.keys(data).length > 0, {
      message: 'At least one field must be provided for update',
    }),
};

const providerIdSchema = {
  params: idParamSchema,
};

const listProvidersSchema = {
  query: z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
      search: z.string().trim().max(100).optional(),
      specialty: z.string().trim().max(120).optional(),
    })
    .strict(),
};

module.exports = {
  NPI_REGEX,
  createProviderSchema,
  updateProviderSchema,
  providerIdSchema,
  listProvidersSchema,
};
