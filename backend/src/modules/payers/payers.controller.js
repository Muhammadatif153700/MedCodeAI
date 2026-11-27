const { prisma } = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');
const HTTP_STATUS = require('../../constants/httpStatus');
const { sendSuccess } = require('../../utils/ApiResponse');
const { AuditService, AUDIT_ACTIONS, AUDIT_ENTITIES } = require('../audit');

// ==========================================
// KAN-36, KAN-37, KAN-38: Code Libraries
// ==========================================

exports.getIcd10Codes = async (_req, res, next) => {
  try {
    const codes = await prisma.icd10Code.findMany();
    return sendSuccess(res, HTTP_STATUS.OK, codes);
  } catch (_error) {
    return next(
      new ApiError(
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        'DB_ERROR',
        'An internal database error occurred.'
      )
    );
  }
};

exports.createIcd10Code = async (req, res, next) => {
  try {
    const code = await prisma.$transaction(async (tx) => {
      const created = await tx.icd10Code.create({ data: req.body });
      await AuditService.log(
        {
          userId: req.user.id,
          action: AUDIT_ACTIONS.CODE_LIBRARY_UPDATED,
          entity: AUDIT_ENTITIES.CODE_LIBRARY,
          entityId: null,
          ipAddress: req.ip,
        },
        { tx }
      );
      return created;
    });
    return sendSuccess(res, HTTP_STATUS.CREATED, code);
  } catch (error) {
    if (error instanceof ApiError) return next(error);
    if (error && error.code === 'P2002') {
      return next(new ApiError(HTTP_STATUS.CONFLICT, 'DUPLICATE_CODE', 'ICD10 code already exists.'));
    }
    return next(new ApiError(HTTP_STATUS.BAD_REQUEST, 'CREATE_FAILED', 'Failed to create ICD10 code.'));
  }
};

exports.getCptCodes = async (_req, res, next) => {
  try {
    const codes = await prisma.cptCode.findMany();
    return sendSuccess(res, HTTP_STATUS.OK, codes);
  } catch (_error) {
    return next(
      new ApiError(
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        'DB_ERROR',
        'An internal database error occurred.'
      )
    );
  }
};

exports.createCptCode = async (req, res, next) => {
  try {
    const code = await prisma.$transaction(async (tx) => {
      const created = await tx.cptCode.create({ data: req.body });
      await AuditService.log(
        {
          userId: req.user.id,
          action: AUDIT_ACTIONS.CODE_LIBRARY_UPDATED,
          entity: AUDIT_ENTITIES.CODE_LIBRARY,
          entityId: null,
          ipAddress: req.ip,
        },
        { tx }
      );
      return created;
    });
    return sendSuccess(res, HTTP_STATUS.CREATED, code);
  } catch (error) {
    if (error instanceof ApiError) return next(error);
    if (error && error.code === 'P2002') {
      return next(new ApiError(HTTP_STATUS.CONFLICT, 'DUPLICATE_CODE', 'CPT code already exists.'));
    }
    return next(new ApiError(HTTP_STATUS.BAD_REQUEST, 'CREATE_FAILED', 'Failed to create CPT code.'));
  }
};

exports.getModifiers = async (_req, res, next) => {
  try {
    const modifiers = await prisma.modifier.findMany();
    return sendSuccess(res, HTTP_STATUS.OK, modifiers);
  } catch (_error) {
    return next(
      new ApiError(
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        'DB_ERROR',
        'An internal database error occurred.'
      )
    );
  }
};

// ==========================================
// KAN-34, KAN-35: Payer Rules & Claim Edits
// ==========================================

exports.getPayerRules = async (req, res, next) => {
  try {
    const rules = await prisma.payerRule.findMany({
      where: { payerId: Number(req.params.payerId) },
    });
    return sendSuccess(res, HTTP_STATUS.OK, rules);
  } catch (_error) {
    return next(
      new ApiError(
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        'DB_ERROR',
        'An internal database error occurred.'
      )
    );
  }
};

exports.createPayerRule = async (req, res, next) => {
  try {
    const rule = await prisma.$transaction(async (tx) => {
      const created = await tx.payerRule.create({ data: req.body });
      await AuditService.log(
        {
          userId: req.user.id,
          action: AUDIT_ACTIONS.PAYER_RULE_CREATED,
          entity: AUDIT_ENTITIES.PAYER_RULE,
          entityId: created.id,
          ipAddress: req.ip,
        },
        { tx }
      );
      return created;
    });
    return sendSuccess(res, HTTP_STATUS.CREATED, rule);
  } catch (error) {
    if (error instanceof ApiError) return next(error);
    return next(new ApiError(HTTP_STATUS.BAD_REQUEST, 'CREATE_FAILED', 'Failed to create Payer Rule.'));
  }
};

exports.getClaimEditRules = async (_req, res, next) => {
  try {
    const rules = await prisma.claimEditRule.findMany();
    return sendSuccess(res, HTTP_STATUS.OK, rules);
  } catch (_error) {
    return next(
      new ApiError(
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        'DB_ERROR',
        'An internal database error occurred.'
      )
    );
  }
};

// ==========================================
// KAN-39: Rate References
// ==========================================
exports.getRateReferences = async (_req, res, next) => {
  try {
    const rates = await prisma.rateReference.findMany();
    return sendSuccess(res, HTTP_STATUS.OK, rates);
  } catch (_error) {
    return next(
      new ApiError(
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        'DB_ERROR',
        'An internal database error occurred.'
      )
    );
  }
};

exports.createRateReference = async (req, res, next) => {
  try {
    const rate = await prisma.$transaction(async (tx) => {
      const created = await tx.rateReference.create({ data: req.body });
      await AuditService.log(
        {
          userId: req.user.id,
          action: AUDIT_ACTIONS.RATE_REFERENCE_CREATED,
          entity: AUDIT_ENTITIES.RATE_REFERENCE,
          entityId: created.id,
          ipAddress: req.ip,
        },
        { tx }
      );
      return created;
    });
    return sendSuccess(res, HTTP_STATUS.CREATED, rate);
  } catch (error) {
    if (error instanceof ApiError) return next(error);
    return next(
      new ApiError(HTTP_STATUS.BAD_REQUEST, 'CREATE_FAILED', 'Failed to create Rate Reference.')
    );
  }
};
