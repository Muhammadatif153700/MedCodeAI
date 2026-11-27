const HTTP_STATUS = require('../../constants/httpStatus');
const ApiError = require('../../utils/ApiError');
const { prisma } = require('../../config/prisma');
const { AuditService, AUDIT_ACTIONS, AUDIT_ENTITIES } = require('../audit');
const encounterRepository = require('./encounter.repository');

const ALLOWED_ENCOUNTER_TRANSITIONS = Object.freeze({
  OPEN: new Set(['CODING_IN_PROGRESS', 'CLOSED']),
  CODING_IN_PROGRESS: new Set(['VALIDATED', 'OPEN', 'CLOSED']),
  VALIDATED: new Set(['CLAIM_SUBMITTED', 'CODING_IN_PROGRESS', 'CLOSED']),
  CLAIM_SUBMITTED: new Set(['CLOSED']),
  CLOSED: new Set([]),
});

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

  static async updateEncounter(id, payload, actor) {
    const existing = await encounterRepository.findEncounterById(id);
    if (!existing) {
      throw new ApiError(
        HTTP_STATUS.NOT_FOUND,
        'ENCOUNTER_NOT_FOUND',
        'Encounter not found'
      );
    }

    if (payload.status && payload.status !== existing.status) {
      const allowedNext = ALLOWED_ENCOUNTER_TRANSITIONS[existing.status] || new Set();
      if (!allowedNext.has(payload.status)) {
        throw new ApiError(
          HTTP_STATUS.BAD_REQUEST,
          'INVALID_STATUS_TRANSITION',
          `Cannot transition encounter status from ${existing.status} to ${payload.status}`
        );
      }
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
        prisma
      );
    }

    try {
      return await prisma.$transaction(async (tx) => {
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

  static async deleteEncounter(id, actor) {
    const existing = await encounterRepository.findEncounterById(id);
    if (!existing) {
      throw new ApiError(
        HTTP_STATUS.NOT_FOUND,
        'ENCOUNTER_NOT_FOUND',
        'Encounter not found'
      );
    }

    const dependentCount = await encounterRepository.countEncounterDependents(id);
    if (dependentCount > 0) {
      throw new ApiError(
        HTTP_STATUS.CONFLICT,
        'DEPENDENT_RECORDS_EXIST',
        'Cannot delete encounter with existing medical records, validations, reports, or claims'
      );
    }

    try {
      return await prisma.$transaction(async (tx) => {
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
