const { prisma } = require('../../config/prisma');

const PROVIDER_SELECT = Object.freeze({
  id: true,
  name: true,
  npi: true,
  specialty: true,
});

async function createProvider(data, dbClient = prisma) {
  return dbClient.provider.create({
    data,
    select: PROVIDER_SELECT,
  });
}

async function findProviderById(id, dbClient = prisma) {
  return dbClient.provider.findUnique({
    where: { id },
    select: PROVIDER_SELECT,
  });
}

async function findProviderByNpi(npi, dbClient = prisma) {
  return dbClient.provider.findUnique({
    where: { npi },
    select: PROVIDER_SELECT,
  });
}

async function findProviders(filters, pagination, dbClient = prisma) {
  const where = {};

  if (filters.specialty) {
    where.specialty = { contains: filters.specialty, mode: 'insensitive' };
  }

  if (filters.search) {
    where.OR = [
      { name: { contains: filters.search, mode: 'insensitive' } },
      { npi: { contains: filters.search, mode: 'insensitive' } },
      { specialty: { contains: filters.search, mode: 'insensitive' } },
    ];
  }

  const skip = (pagination.page - 1) * pagination.limit;

  const [items, total] = await Promise.all([
    dbClient.provider.findMany({
      where,
      skip,
      take: pagination.limit,
      orderBy: [{ id: 'desc' }],
      select: PROVIDER_SELECT,
    }),
    dbClient.provider.count({ where }),
  ]);

  return { items, total };
}

async function updateProviderById(id, data, dbClient = prisma) {
  return dbClient.provider.update({
    where: { id },
    data,
    select: PROVIDER_SELECT,
  });
}

async function countProviderEncounters(providerId, dbClient = prisma) {
  return dbClient.encounter.count({
    where: { providerId },
  });
}

async function deleteProviderById(id, dbClient = prisma) {
  return dbClient.provider.delete({
    where: { id },
    select: PROVIDER_SELECT,
  });
}

module.exports = {
  PROVIDER_SELECT,
  createProvider,
  findProviderById,
  findProviderByNpi,
  findProviders,
  updateProviderById,
  countProviderEncounters,
  deleteProviderById,
};
