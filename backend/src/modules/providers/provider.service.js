const HTTP_STATUS = require('../../constants/httpStatus');
const ApiError = require('../../utils/ApiError');
const { prisma } = require('../../config/prisma');
const { AuditService, AUDIT_ACTIONS, AUDIT_ENTITIES } = require('../audit');
const providerRepository = require('./provider.repository');

class ProviderService {
  static async createProvider(payload, actor) {
    const existingNpi = await providerRepository.findProviderByNpi(payload.npi);
    if (existingNpi) {
      throw new ApiError(
        HTTP_STATUS.CONFLICT,
        'DUPLICATE_NPI',
        'A provider with this NPI already exists'
      );
    }

    try {
      return await prisma.$transaction(async (tx) => {
        const provider = await providerRepository.createProvider(
          {
            name: payload.name,
            npi: payload.npi,
            specialty: payload.specialty,
          },
          tx
        );

        await AuditService.log(
          {
            userId: actor.userId,
            action: AUDIT_ACTIONS.PROVIDER_CREATED,
            entity: AUDIT_ENTITIES.PROVIDER,
            entityId: provider.id,
            ipAddress: actor.ipAddress,
          },
          { tx }
        );

        return provider;
      });
    } catch (err) {
      if (err && err.code === 'P2002') {
        throw new ApiError(
          HTTP_STATUS.CONFLICT,
          'DUPLICATE_NPI',
          'A provider with this NPI already exists'
        );
      }
      throw err;
    }
  }

  static async listProviders(query = {}) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;
    const { items, total } = await providerRepository.findProviders(
      { search: query.search, specialty: query.specialty },
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

  static async getProviderById(id) {
    const provider = await providerRepository.findProviderById(id);
    if (!provider) {
      throw new ApiError(
        HTTP_STATUS.NOT_FOUND,
        'PROVIDER_NOT_FOUND',
        'Provider not found'
      );
    }
    return provider;
  }

  static async updateProvider(id, payload, actor) {
    const existing = await providerRepository.findProviderById(id);
    if (!existing) {
      throw new ApiError(
        HTTP_STATUS.NOT_FOUND,
        'PROVIDER_NOT_FOUND',
        'Provider not found'
      );
    }

    if (payload.npi && payload.npi !== existing.npi) {
      const duplicate = await providerRepository.findProviderByNpi(payload.npi);
      if (duplicate) {
        throw new ApiError(
          HTTP_STATUS.CONFLICT,
          'DUPLICATE_NPI',
          'A provider with this NPI already exists'
        );
      }
    }

    try {
      return await prisma.$transaction(async (tx) => {
        const updated = await providerRepository.updateProviderById(id, payload, tx);

        await AuditService.log(
          {
            userId: actor.userId,
            action: AUDIT_ACTIONS.PROVIDER_UPDATED,
            entity: AUDIT_ENTITIES.PROVIDER,
            entityId: updated.id,
            ipAddress: actor.ipAddress,
          },
          { tx }
        );

        return updated;
      });
    } catch (err) {
      if (err && err.code === 'P2002') {
        throw new ApiError(
          HTTP_STATUS.CONFLICT,
          'DUPLICATE_NPI',
          'A provider with this NPI already exists'
        );
      }
      throw err;
    }
  }

  static async deleteProvider(id, actor) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const existing = await providerRepository.findProviderById(id, tx);
          if (!existing) {
            throw new ApiError(
              HTTP_STATUS.NOT_FOUND,
              'PROVIDER_NOT_FOUND',
              'Provider not found'
            );
          }

          const dependentCount = await providerRepository.countProviderEncounters(id, tx);
          if (dependentCount > 0) {
            throw new ApiError(
              HTTP_STATUS.CONFLICT,
              'DEPENDENT_RECORDS_EXIST',
              'Cannot delete provider with existing encounters'
            );
          }

          const deleted = await providerRepository.deleteProviderById(id, tx);

          await AuditService.log(
            {
              userId: actor.userId,
              action: AUDIT_ACTIONS.PROVIDER_DELETED,
              entity: AUDIT_ENTITIES.PROVIDER,
              entityId: id,
              ipAddress: actor.ipAddress,
            },
            { tx }
          );

          return deleted;
        },
        { isolationLevel: 'Serializable' }
      );
    } catch (err) {
      if (err && err.code === 'P2003') {
        throw new ApiError(
          HTTP_STATUS.CONFLICT,
          'DEPENDENT_RECORDS_EXIST',
          'Cannot delete provider with existing dependent records'
        );
      }
      throw err;
    }
  }
}

module.exports = ProviderService;
