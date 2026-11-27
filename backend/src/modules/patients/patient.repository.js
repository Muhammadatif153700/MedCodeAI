const { prisma } = require('../../config/prisma');

const PATIENT_SELECT = Object.freeze({
  id: true,
  name: true,
  dob: true,
  gender: true,
  memberId: true,
});

async function createPatient(data, dbClient = prisma) {
  return dbClient.patient.create({
    data,
    select: PATIENT_SELECT,
  });
}

async function findPatientById(id, dbClient = prisma) {
  return dbClient.patient.findUnique({
    where: { id },
    select: PATIENT_SELECT,
  });
}

async function findPatients(filters, pagination, dbClient = prisma) {
  const where = {};

  if (filters.gender) {
    where.gender = { equals: filters.gender, mode: 'insensitive' };
  }

  if (filters.search) {
    where.OR = [
      { name: { contains: filters.search, mode: 'insensitive' } },
      { memberId: { contains: filters.search, mode: 'insensitive' } },
    ];
  }

  const skip = (pagination.page - 1) * pagination.limit;

  const [items, total] = await Promise.all([
    dbClient.patient.findMany({
      where,
      skip,
      take: pagination.limit,
      orderBy: [{ id: 'desc' }],
      select: PATIENT_SELECT,
    }),
    dbClient.patient.count({ where }),
  ]);

  return { items, total };
}

async function updatePatientById(id, data, dbClient = prisma) {
  return dbClient.patient.update({
    where: { id },
    data,
    select: PATIENT_SELECT,
  });
}

async function countPatientEncounters(patientId, dbClient = prisma) {
  return dbClient.encounter.count({
    where: { patientId },
  });
}

async function deletePatientById(id, dbClient = prisma) {
  return dbClient.patient.delete({
    where: { id },
    select: PATIENT_SELECT,
  });
}

module.exports = {
  PATIENT_SELECT,
  createPatient,
  findPatientById,
  findPatients,
  updatePatientById,
  countPatientEncounters,
  deletePatientById,
};
