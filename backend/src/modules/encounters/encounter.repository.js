const { prisma } = require('../../config/prisma');

const ENCOUNTER_SELECT = Object.freeze({
  id: true,
  patientId: true,
  providerId: true,
  payerId: true,
  planId: true,
  encounterDate: true,
  placeOfService: true,
  status: true,
  patient: {
    select: {
      id: true,
      name: true,
      memberId: true,
    },
  },
  provider: {
    select: {
      id: true,
      name: true,
      npi: true,
      specialty: true,
    },
  },
  payer: {
    select: {
      id: true,
      name: true,
    },
  },
  plan: {
    select: {
      id: true,
      payerId: true,
      name: true,
      authRequired: true,
    },
  },
});

async function createEncounter(data, dbClient = prisma) {
  return dbClient.encounter.create({
    data,
    select: ENCOUNTER_SELECT,
  });
}

async function findEncounterById(id, dbClient = prisma) {
  return dbClient.encounter.findUnique({
    where: { id },
    select: ENCOUNTER_SELECT,
  });
}

async function findEncounters(filters, pagination, dbClient = prisma) {
  const where = {};

  if (filters.patientId !== undefined) where.patientId = filters.patientId;
  if (filters.providerId !== undefined) where.providerId = filters.providerId;
  if (filters.payerId !== undefined) where.payerId = filters.payerId;
  if (filters.status !== undefined) where.status = filters.status;
  if (filters.startDate !== undefined || filters.endDate !== undefined) {
    where.encounterDate = {};
    if (filters.startDate !== undefined) where.encounterDate.gte = filters.startDate;
    if (filters.endDate !== undefined) where.encounterDate.lte = filters.endDate;
  }

  const skip = (pagination.page - 1) * pagination.limit;

  const [items, total] = await Promise.all([
    dbClient.encounter.findMany({
      where,
      skip,
      take: pagination.limit,
      orderBy: [{ encounterDate: 'desc' }, { id: 'desc' }],
      select: ENCOUNTER_SELECT,
    }),
    dbClient.encounter.count({ where }),
  ]);

  return { items, total };
}

async function updateEncounterById(id, data, dbClient = prisma) {
  return dbClient.encounter.update({
    where: { id },
    data,
    select: ENCOUNTER_SELECT,
  });
}

async function countEncounterDependents(encounterId, dbClient = prisma) {
  const [records, validations, risks, reports, claims] = await Promise.all([
    dbClient.medicalRecord.count({ where: { encounterId } }),
    dbClient.validationResult.count({ where: { encounterId } }),
    dbClient.denialRisk.count({ where: { encounterId } }),
    dbClient.report.count({ where: { encounterId } }),
    dbClient.claim.count({ where: { encounterId } }),
  ]);

  return records + validations + risks + reports + claims;
}

async function deleteEncounterById(id, dbClient = prisma) {
  return dbClient.encounter.delete({
    where: { id },
    select: ENCOUNTER_SELECT,
  });
}

async function findReferences({ patientId, providerId, payerId, planId }, dbClient = prisma) {
  const [patient, provider, payer, plan] = await Promise.all([
    patientId !== undefined ? dbClient.patient.findUnique({ where: { id: patientId }, select: { id: true } }) : null,
    providerId !== undefined ? dbClient.provider.findUnique({ where: { id: providerId }, select: { id: true } }) : null,
    payerId !== undefined ? dbClient.payer.findUnique({ where: { id: payerId }, select: { id: true } }) : null,
    planId !== undefined ? dbClient.insurancePlan.findUnique({ where: { id: planId }, select: { id: true, payerId: true } }) : null,
  ]);

  return { patient, provider, payer, plan };
}

async function updateEncounterStatusIfCurrent(id, expectedStatus, nextStatus, dbClient = prisma) {
  return dbClient.encounter.updateMany({
    where: { id, status: expectedStatus },
    data: { status: nextStatus },
  });
}

async function countCodingPrerequisites(encounterId, dbClient = prisma) {
  return dbClient.medicalRecord.count({ where: { encounterId } });
}

async function countValidationPrerequisites(encounterId, dbClient = prisma) {
  const [totalValidations, failedValidations, acceptedSuggestions, pendingSuggestions] =
    await Promise.all([
      dbClient.validationResult.count({ where: { encounterId } }),
      dbClient.validationResult.count({ where: { encounterId, status: 'FAILED' } }),
      dbClient.codingSuggestion.count({
        where: {
          reviewStatus: { in: ['ACCEPTED', 'EDITED'] },
          analysis: { record: { encounterId } },
        },
      }),
      dbClient.codingSuggestion.count({
        where: {
          reviewStatus: 'SUGGESTED',
          analysis: { record: { encounterId } },
        },
      }),
    ]);
  return { totalValidations, failedValidations, acceptedSuggestions, pendingSuggestions };
}

async function countSubmittedClaims(encounterId, dbClient = prisma) {
  return dbClient.claim.count({
    where: {
      encounterId,
      status: { in: ['SUBMITTED', 'IN_PROCESS', 'ACCEPTED', 'PAID', 'RESUBMITTED'] },
      externalRef: { not: null },
    },
  });
}

async function countNonTerminalClaims(encounterId, dbClient = prisma) {
  return dbClient.claim.count({
    where: {
      encounterId,
      status: { notIn: ['PAID', 'DENIED', 'CLOSED'] },
    },
  });
}

module.exports = {
  ENCOUNTER_SELECT,
  createEncounter,
  findEncounterById,
  findEncounters,
  updateEncounterById,
  updateEncounterStatusIfCurrent,
  countEncounterDependents,
  countCodingPrerequisites,
  countValidationPrerequisites,
  countSubmittedClaims,
  countNonTerminalClaims,
  deleteEncounterById,
  findReferences,
};
