const { z } = require('zod');

const ENCOUNTER_STATUSES = [
  'OPEN',
  'CODING_IN_PROGRESS',
  'VALIDATED',
  'CLAIM_SUBMITTED',
  'CLOSED',
];

const idParamSchema = z.object({
  id: z.coerce
    .number({ invalid_type_error: 'Encounter id must be a positive integer' })
    .int('Encounter id must be an integer')
    .positive('Encounter id must be a positive integer'),
});

const positiveInt = (label) =>
  z
    .number({
      required_error: `${label} is required`,
      invalid_type_error: `${label} must be a positive integer`,
    })
    .int(`${label} must be an integer`)
    .positive(`${label} must be a positive integer`);

const createEncounterSchema = {
  body: z
    .object({
      patientId: positiveInt('patientId'),
      providerId: positiveInt('providerId'),
      payerId: positiveInt('payerId'),
      planId: positiveInt('planId'),
      encounterDate: z.coerce.date({
        invalid_type_error: 'encounterDate must be a valid date',
      }),
      placeOfService: z
        .string({ required_error: 'placeOfService is required' })
        .trim()
        .min(1, 'placeOfService is required')
        .max(50, 'placeOfService must not exceed 50 characters'),
    })
    .strict(),
};

const updateEncounterSchema = {
  params: idParamSchema,
  body: z
    .object({
      patientId: positiveInt('patientId').optional(),
      providerId: positiveInt('providerId').optional(),
      payerId: positiveInt('payerId').optional(),
      planId: positiveInt('planId').optional(),
      encounterDate: z.coerce
        .date({ invalid_type_error: 'encounterDate must be a valid date' })
        .optional(),
      placeOfService: z
        .string()
        .trim()
        .min(1, 'placeOfService is required')
        .max(50, 'placeOfService must not exceed 50 characters')
        .optional(),
      status: z.enum(ENCOUNTER_STATUSES).optional(),
    })
    .strict()
    .refine((data) => Object.keys(data).length > 0, {
      message: 'At least one field must be provided for update',
    }),
};

const encounterIdSchema = {
  params: idParamSchema,
};

const listEncountersSchema = {
  query: z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
      patientId: z.coerce.number().int().positive().optional(),
      providerId: z.coerce.number().int().positive().optional(),
      payerId: z.coerce.number().int().positive().optional(),
      status: z.enum(ENCOUNTER_STATUSES).optional(),
      startDate: z.coerce.date().optional(),
      endDate: z.coerce.date().optional(),
    })
    .strict()
    .refine(
      (data) => {
        if (data.startDate && data.endDate) {
          return data.startDate <= data.endDate;
        }
        return true;
      },
      {
        message: 'startDate must be less than or equal to endDate',
        path: ['startDate'],
      }
    ),
};

module.exports = {
  ENCOUNTER_STATUSES,
  createEncounterSchema,
  updateEncounterSchema,
  encounterIdSchema,
  listEncountersSchema,
};
