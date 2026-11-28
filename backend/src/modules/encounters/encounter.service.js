const HTTP_STATUS = require('../../constants/httpStatus');
const { ROLES } = require('../../constants/roles');
const ApiError = require('../../utils/ApiError');
const { prisma } = require('../../config/prisma');
const { AuditService, AUDIT_ACTIONS, AUDIT_ENTITIES } = require('../audit');
const encounterRepository = require('./encounter.repository');

const SERIALIZABLE_TX = {
  isolationLevel: 'Serializable',
  maxWait: 10000,
  timeout: 30000,
};

const ALLOWED_ENCOUNTER_TRANSITIONS = Object.freeze({
  OPEN: new Set(['CODING_IN_PROGRESS', 'CLOSED']),
  CODING_IN_PROGRESS: new Set(['VALIDATED']),
  VALIDATED: new Set(['CLAIM_SUBMITTED']),
  CLAIM_SUBMITTED: new Set(['CLOSED']),
  CLOSED: new Set([]),
});

async function runWithTransaction(options, fn) {
  if (options && options.tx) {
    return fn(options.tx);
  }
  try {
    return await prisma.$transaction(fn, SERIALIZABLE_TX);
  } catch (err) {
    if (err && err.code === 'P2034') {
      throw new ApiError(
        HTTP_STATUS.CONFLICT,
        'CONCURRENT_MODIFICATION',
        'Concurrent encounter modification detected, please retry'
      );
    }
    throw err;
  }
}

function assertActorRole(actor, allowedRoles) {
  if (!actor || !actor.userId || !actor.role || !allowedRoles.includes(actor.role)) {
    throw new ApiError(
      HTTP_STATUS.FORBIDDEN,
      'FORBIDDEN',
      'Actor does not have permission for this encounter lifecycle transition'
    );
  }
}

async function validateReferences({ patientId, providerId, payerId, planId }, dbClient) {
  const refs = await encounterRepository.findReferences(
    { patientId, providerId, payerId, planId },
    dbClient
  );

  if (patientId !== undefined && !refs.patient) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'PATIENT_NOT_FOUND', 'Patient not found');
  }
  if (providerId !== undefined && !refs.provider) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'PROVIDER_NOT_FOUND', 'Provider not found');
  }
  if (payerId !== undefined && !refs.payer) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'PAYER_NOT_FOUND', 'Payer not found');
  }
  if (planId !== undefined && !refs.plan) {
    throw new ApiError(
      HTTP_STATUS.NOT_FOUND,
      'INSURANCE_PLAN_NOT_FOUND',
      'Insurance plan not found'
    );
  }
  if (refs.plan && payerId !== undefined && refs.plan.payerId !== payerId) {
    throw new ApiError(
      HTTP_STATUS.BAD_REQUEST,
      'PAYER_PLAN_MISMATCH',
      'Selected insurance plan does not belong to the selected payer'
    );
  }
}

async function applyTransition({ encounterId, expectedStatus, nextStatus, actor, tx }) {
  const updateResult = await encounterRepository.updateEncounterStatusIfCurrent(
    encounterId,
    expectedStatus,
    nextStatus,
    tx
  );

  if (!updateResult || updateResult.count !== 1) {
    throw new ApiError(
      HTTP_STATUS.CONFLICT,
      'CONCURRENT_MODIFICATION',
      'Encounter status changed concurrently, please retry'
    );
  }

  await AuditService.log(
    {
      userId: actor.userId,
      action: AUDIT_ACTIONS.ENCOUNTER_UPDATED,
      entity: AUDIT_ENTITIES.ENCOUNTER,
      entityId: encounterId,
      ipAddress: actor.ipAddress,
    },
    { tx }
  );

  return encounterRepository.findEncounterById(encounterId, tx);
}

class EncounterService {
  static async createEncounter(payload, actor) {
    await validateReferences(
      {
        patientId: payload.patientId,
        providerId: payload.providerId,
        payerId: payload.payerId,
        planId: payload.planId,
      },
      prisma
    );

    try {
      return await prisma.$transaction(async (tx) => {
        const encounter = await encounterRepository.createEncounter(
          {
            patientId: payload.patientId,
            providerId: payload.providerId,
            payerId: payload.payerId,
            planId: payload.planId,
            encounterDate: payload.encounterDate,
            placeOfService: payload.placeOfService,
            status: 'OPEN',
          },
          tx
        );

        await AuditService.log(
          {
            userId: actor.userId,
            action: AUDIT_ACTIONS.ENCOUNTER_CREATED,
            entity: AUDIT_ENTITIES.ENCOUNTER,
            entityId: encounter.id,
            ipAddress: actor.ipAddress,
          },
          { tx }
        );

        return encounter;
      });
    } catch (err) {
      if (err && err.code === 'P2003') {
        throw new ApiError(
          HTTP_STATUS.BAD_REQUEST,
          'INVALID_ENCOUNTER_REFERENCE',
          'One or more referenced entities (patient, provider, payer, or plan) are invalid'
        );
      }
      throw err;
    }
  }

  static async listEncounters(query = {}) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;

    const { items, total } = await encounterRepository.findEncounters(
      {
        patientId: query.patientId !== undefined ? Number(query.patientId) : undefined,
        providerId: query.providerId !== undefined ? Number(query.providerId) : undefined,
        payerId: query.payerId !== undefined ? Number(query.payerId) : undefined,
        status: query.status,
        startDate: query.startDate,
        endDate: query.endDate,
      },
      { page, limit }
    );

    return {
      items,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 0,
      },
    };
  }

  static async getEncounterById(id) {
    const encounter = await encounterRepository.findEncounterById(id);
    if (!encounter) {
      throw new ApiError(
        HTTP_STATUS.NOT_FOUND,
        'ENCOUNTER_NOT_FOUND',
        'Encounter not found'
      );
    }
    return encounter;
  }

  /**
   * Generic metadata update (PATCH /api/v1/encounters/:id).
   * Disallows workflow status changes and blocks edits once workflow artifacts exist or status !== OPEN.
   */
  static async updateEncounter(id, payload, actor) {
    try {
      return await runWithTransaction({}, async (tx) => {
        const existing = await encounterRepository.findEncounterById(id, tx);
        if (!existing) {
          throw new ApiError(
            HTTP_STATUS.NOT_FOUND,
            'ENCOUNTER_NOT_FOUND',
            'Encounter not found'
          );
        }

        if (existing.status !== 'OPEN') {
          throw new ApiError(
            HTTP_STATUS.CONFLICT,
            'ENCOUNTER_LOCKED',
            `Encounter metadata cannot be edited while status is ${existing.status}`
          );
        }

        const dependentCount = await encounterRepository.countEncounterDependents(id, tx);
        if (dependentCount > 0) {
          throw new ApiError(
            HTTP_STATUS.CONFLICT,
            'DEPENDENT_RECORDS_EXIST',
            'Encounter metadata cannot be edited after medical records, validations, reports, or claims exist'
          );
        }

        const targetPayerId = payload.payerId ?? existing.payerId;
        const targetPlanId = payload.planId ?? existing.planId;
        const needsRefCheck =
          payload.patientId !== undefined ||
          payload.providerId !== undefined ||
          payload.payerId !== undefined ||
          payload.planId !== undefined;

        if (needsRefCheck) {
          await validateReferences(
            {
              patientId: payload.patientId,
              providerId: payload.providerId,
              payerId: targetPayerId,
              planId: targetPlanId,
            },
            tx
          );
        }

        const updated = await encounterRepository.updateEncounterById(id, payload, tx);

        await AuditService.log(
          {
            userId: actor.userId,
            action: AUDIT_ACTIONS.ENCOUNTER_UPDATED,
            entity: AUDIT_ENTITIES.ENCOUNTER,
            entityId: updated.id,
            ipAddress: actor.ipAddress,
          },
          { tx }
        );

        return updated;
      });
    } catch (err) {
      if (err && err.code === 'P2003') {
        throw new ApiError(
          HTTP_STATUS.BAD_REQUEST,
          'INVALID_ENCOUNTER_REFERENCE',
          'One or more referenced entities (patient, provider, payer, or plan) are invalid'
        );
      }
      throw err;
    }
  }

  /**
   * Internal lifecycle transition: OPEN -> CODING_IN_PROGRESS (KAN-5).
   * Requires at least one MedicalRecord for the encounter.
   */
  static async startCoding(encounterId, actor, options = {}) {
    assertActorRole(actor, [ROLES.CODER, ROLES.ADMIN]);

    return runWithTransaction(options, async (tx) => {
      const existing = await encounterRepository.findEncounterById(encounterId, tx);
      if (!existing) {
        throw new ApiError(HTTP_STATUS.NOT_FOUND, 'ENCOUNTER_NOT_FOUND', 'Encounter not found');
      }
      if (existing.status !== 'OPEN') {
        throw new ApiError(
          HTTP_STATUS.BAD_REQUEST,
          'INVALID_STATUS_TRANSITION',
          `Cannot start coding when encounter status is ${existing.status}`
        );
      }

      const recordCount = await encounterRepository.countCodingPrerequisites(encounterId, tx);
      if (recordCount < 1) {
        throw new ApiError(
          HTTP_STATUS.BAD_REQUEST,
          'CODING_PREREQUISITE_MISSING',
          'At least one medical record is required before starting coding'
        );
      }

      return applyTransition({
        encounterId,
        expectedStatus: 'OPEN',
        nextStatus: 'CODING_IN_PROGRESS',
        actor,
        tx,
      });
    });
  }

  /**
   * Internal lifecycle transition: CODING_IN_PROGRESS -> VALIDATED (KAN-6).
   * Requires accepted/edited coding suggestions and non-failed ValidationResult rows.
   */
  static async markValidated(encounterId, actor, options = {}) {
    assertActorRole(actor, [ROLES.BILLING_SPECIALIST, ROLES.CODER, ROLES.ADMIN]);

    return runWithTransaction(options, async (tx) => {
      const existing = await encounterRepository.findEncounterById(encounterId, tx);
      if (!existing) {
        throw new ApiError(HTTP_STATUS.NOT_FOUND, 'ENCOUNTER_NOT_FOUND', 'Encounter not found');
      }
      if (existing.status !== 'CODING_IN_PROGRESS') {
        throw new ApiError(
          HTTP_STATUS.BAD_REQUEST,
          'INVALID_STATUS_TRANSITION',
          `Cannot mark encounter validated when status is ${existing.status}`
        );
      }

      const {
        totalValidations,
        failedValidations,
        acceptedSuggestions,
        pendingSuggestions,
      } = await encounterRepository.countValidationPrerequisites(encounterId, tx);

      if (acceptedSuggestions < 1) {
        throw new ApiError(
          HTTP_STATUS.BAD_REQUEST,
          'VALIDATION_PREREQUISITE_MISSING',
          'Accepted or edited coding suggestions are required before validation'
        );
      }
      if (pendingSuggestions > 0) {
        throw new ApiError(
          HTTP_STATUS.BAD_REQUEST,
          'UNREVIEWED_SUGGESTIONS_EXIST',
          'All suggested codes must be reviewed before marking encounter validated'
        );
      }
      if (totalValidations < 1 || failedValidations > 0) {
        throw new ApiError(
          HTTP_STATUS.BAD_REQUEST,
          'VALIDATION_NOT_PASSED',
          'Encounter must have passing validation results with zero FAILED checks'
        );
      }

      return applyTransition({
        encounterId,
        expectedStatus: 'CODING_IN_PROGRESS',
        nextStatus: 'VALIDATED',
        actor,
        tx,
      });
    });
  }

  /**
   * Internal lifecycle transition: VALIDATED -> CLAIM_SUBMITTED (KAN-7).
   * Requires a submitted Claim with a non-null externalRef belonging to this encounter.
   */
  static async markClaimSubmitted(encounterId, actor, options = {}) {
    assertActorRole(actor, [ROLES.BILLING_SPECIALIST]);

    return runWithTransaction(options, async (tx) => {
      const existing = await encounterRepository.findEncounterById(encounterId, tx);
      if (!existing) {
        throw new ApiError(HTTP_STATUS.NOT_FOUND, 'ENCOUNTER_NOT_FOUND', 'Encounter not found');
      }
      if (existing.status !== 'VALIDATED') {
        throw new ApiError(
          HTTP_STATUS.BAD_REQUEST,
          'INVALID_STATUS_TRANSITION',
          `Cannot mark claim submitted when encounter status is ${existing.status}`
        );
      }

      const submittedClaims = await encounterRepository.countSubmittedClaims(encounterId, tx);
      if (submittedClaims < 1) {
        throw new ApiError(
          HTTP_STATUS.BAD_REQUEST,
          'CLAIM_NOT_SUBMITTED',
          'An actually submitted claim with an external reference is required'
        );
      }

      return applyTransition({
        encounterId,
        expectedStatus: 'VALIDATED',
        nextStatus: 'CLAIM_SUBMITTED',
        actor,
        tx,
      });
    });
  }

  /**
   * Internal lifecycle transition: OPEN (admin-only with 0 dependents) or CLAIM_SUBMITTED (all claims terminal) -> CLOSED.
   */
  static async closeEncounter(encounterId, actor, options = {}) {
    assertActorRole(actor, [ROLES.ADMIN, ROLES.BILLING_SPECIALIST]);

    return runWithTransaction(options, async (tx) => {
      const existing = await encounterRepository.findEncounterById(encounterId, tx);
      if (!existing) {
        throw new ApiError(HTTP_STATUS.NOT_FOUND, 'ENCOUNTER_NOT_FOUND', 'Encounter not found');
      }

      if (existing.status === 'OPEN') {
        if (actor.role !== ROLES.ADMIN) {
          throw new ApiError(
            HTTP_STATUS.FORBIDDEN,
            'FORBIDDEN',
            'Only administrators can close an OPEN encounter'
          );
        }
        const dependents = await encounterRepository.countEncounterDependents(encounterId, tx);
        if (dependents > 0) {
          throw new ApiError(
            HTTP_STATUS.CONFLICT,
            'DEPENDENT_RECORDS_EXIST',
            'Cannot close an OPEN encounter with dependent workflow artifacts'
          );
        }
      } else if (existing.status === 'CLAIM_SUBMITTED') {
        const openClaims = await encounterRepository.countNonTerminalClaims(encounterId, tx);
        if (openClaims > 0) {
          throw new ApiError(
            HTTP_STATUS.CONFLICT,
            'OPEN_CLAIMS_EXIST',
            'Cannot close encounter while submitted claims are not Paid, Denied, or Closed'
          );
        }
      } else {
        throw new ApiError(
          HTTP_STATUS.BAD_REQUEST,
          'INVALID_STATUS_TRANSITION',
          `Cannot close encounter when status is ${existing.status}`
        );
      }

      return applyTransition({
        encounterId,
        expectedStatus: existing.status,
        nextStatus: 'CLOSED',
        actor,
        tx,
      });
    });
  }

  static async deleteEncounter(id, actor) {
    try {
      return await runWithTransaction({}, async (tx) => {
        const existing = await encounterRepository.findEncounterById(id, tx);
        if (!existing) {
          throw new ApiError(
            HTTP_STATUS.NOT_FOUND,
            'ENCOUNTER_NOT_FOUND',
            'Encounter not found'
          );
        }

        const dependentCount = await encounterRepository.countEncounterDependents(id, tx);
        if (dependentCount > 0) {
          throw new ApiError(
            HTTP_STATUS.CONFLICT,
            'DEPENDENT_RECORDS_EXIST',
            'Cannot delete encounter with existing medical records, validations, reports, or claims'
          );
        }

        const deleted = await encounterRepository.deleteEncounterById(id, tx);

        await AuditService.log(
          {
            userId: actor.userId,
            action: AUDIT_ACTIONS.ENCOUNTER_DELETED,
            entity: AUDIT_ENTITIES.ENCOUNTER,
            entityId: id,
            ipAddress: actor.ipAddress,
          },
          { tx }
        );

        return deleted;
      });
    } catch (err) {
      if (err && err.code === 'P2003') {
        throw new ApiError(
          HTTP_STATUS.CONFLICT,
          'DEPENDENT_RECORDS_EXIST',
          'Cannot delete encounter with existing dependent records'
        );
      }
      throw err;
    }
  }
}

module.exports = EncounterService;
module.exports.ALLOWED_ENCOUNTER_TRANSITIONS = ALLOWED_ENCOUNTER_TRANSITIONS;
