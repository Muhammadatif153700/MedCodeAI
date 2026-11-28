const HTTP_STATUS = require('../../constants/httpStatus');
const ApiError = require('../../utils/ApiError');
const { prisma } = require('../../config/prisma');
const { AuditService, AUDIT_ACTIONS, AUDIT_ENTITIES } = require('../audit');
const patientRepository = require('./patient.repository');

class PatientService {
  static async createPatient(payload, actor) {
    return prisma.$transaction(async (tx) => {
      const patient = await patientRepository.createPatient(
        {
          name: payload.name,
          dob: payload.dob,
          gender: payload.gender,
          memberId: payload.memberId,
        },
        tx
      );

      await AuditService.log(
        {
          userId: actor.userId,
          action: AUDIT_ACTIONS.PATIENT_CREATED,
          entity: AUDIT_ENTITIES.PATIENT,
          entityId: patient.id,
          ipAddress: actor.ipAddress,
        },
        { tx }
      );

      return patient;
    });
  }

  static async listPatients(query = {}) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;
    const { items, total } = await patientRepository.findPatients(
      { search: query.search, gender: query.gender },
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

  static async getPatientById(id) {
    const patient = await patientRepository.findPatientById(id);
    if (!patient) {
      throw new ApiError(
        HTTP_STATUS.NOT_FOUND,
        'PATIENT_NOT_FOUND',
        'Patient not found'
      );
    }
    return patient;
  }

  static async updatePatient(id, payload, actor) {
    const existing = await patientRepository.findPatientById(id);
    if (!existing) {
      throw new ApiError(
        HTTP_STATUS.NOT_FOUND,
        'PATIENT_NOT_FOUND',
        'Patient not found'
      );
    }

    return prisma.$transaction(async (tx) => {
      const updated = await patientRepository.updatePatientById(id, payload, tx);

      await AuditService.log(
        {
          userId: actor.userId,
          action: AUDIT_ACTIONS.PATIENT_UPDATED,
          entity: AUDIT_ENTITIES.PATIENT,
          entityId: updated.id,
          ipAddress: actor.ipAddress,
        },
        { tx }
      );

      return updated;
    });
  }

  static async deletePatient(id, actor) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const existing = await patientRepository.findPatientById(id, tx);
          if (!existing) {
            throw new ApiError(
              HTTP_STATUS.NOT_FOUND,
              'PATIENT_NOT_FOUND',
              'Patient not found'
            );
          }

          const dependentCount = await patientRepository.countPatientEncounters(id, tx);
          if (dependentCount > 0) {
            throw new ApiError(
              HTTP_STATUS.CONFLICT,
              'DEPENDENT_RECORDS_EXIST',
              'Cannot delete patient with existing encounters'
            );
          }

          const deleted = await patientRepository.deletePatientById(id, tx);

          await AuditService.log(
            {
              userId: actor.userId,
              action: AUDIT_ACTIONS.PATIENT_DELETED,
              entity: AUDIT_ENTITIES.PATIENT,
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
          'Cannot delete patient with existing dependent records'
        );
      }
      throw err;
    }
  }
}

module.exports = PatientService;
