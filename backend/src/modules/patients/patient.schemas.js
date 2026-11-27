const { z } = require('zod');

const idParamSchema = z.object({
  id: z.coerce
    .number({ invalid_type_error: 'Patient id must be a positive integer' })
    .int('Patient id must be an integer')
    .positive('Patient id must be a positive integer'),
});

function isNotFutureDate(date) {
  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
  return date <= todayUtc;
}

const dobSchema = z.coerce
  .date({ invalid_type_error: 'dob must be a valid date' })
  .refine(isNotFutureDate, {
    message: 'Date of birth cannot be in the future',
  });

const createPatientSchema = {
  body: z
    .object({
      name: z
        .string({ required_error: 'name is required' })
        .trim()
        .min(2, 'name must be at least 2 characters')
        .max(120, 'name must not exceed 120 characters'),
      dob: dobSchema,
      gender: z
        .string({ required_error: 'gender is required' })
        .trim()
        .min(1, 'gender is required')
        .max(50, 'gender must not exceed 50 characters'),
      memberId: z
        .string({ required_error: 'memberId is required' })
        .trim()
        .min(1, 'memberId is required')
        .max(100, 'memberId must not exceed 100 characters'),
    })
    .strict(),
};

const updatePatientSchema = {
  params: idParamSchema,
  body: z
    .object({
      name: z
        .string()
        .trim()
        .min(2, 'name must be at least 2 characters')
        .max(120, 'name must not exceed 120 characters')
        .optional(),
      dob: dobSchema.optional(),
      gender: z
        .string()
        .trim()
        .min(1, 'gender is required')
        .max(50, 'gender must not exceed 50 characters')
        .optional(),
      memberId: z
        .string()
        .trim()
        .min(1, 'memberId is required')
        .max(100, 'memberId must not exceed 100 characters')
        .optional(),
    })
    .strict()
    .refine((data) => Object.keys(data).length > 0, {
      message: 'At least one field must be provided for update',
    }),
};

const patientIdSchema = {
  params: idParamSchema,
};

const listPatientsSchema = {
  query: z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
      search: z.string().trim().max(100).optional(),
      gender: z.string().trim().max(50).optional(),
    })
    .strict(),
};

module.exports = {
  createPatientSchema,
  updatePatientSchema,
  patientIdSchema,
  listPatientsSchema,
};
