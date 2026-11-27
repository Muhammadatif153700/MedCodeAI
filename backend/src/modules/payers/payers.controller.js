const prisma = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');
const HTTP_STATUS = require('../../constants/httpStatus');
const { sendSuccess } = require('../../utils/ApiResponse');
const AuditService = require('../audit/audit.service');
const { AUDIT_ACTIONS, AUDIT_ENTITIES } = require('../audit/audit.constants');

// ==========================================
// KAN-36, KAN-37, KAN-38: Code Libraries
// ==========================================

exports.getIcd10Codes = async (req, res, next) => {
  try {
    const codes = await prisma.icd10Code.findMany();
    return sendSuccess(res, HTTP_STATUS.OK, codes);
  } catch (error) {
    console.error("DB Error:", error);
    next(new ApiError(HTTP_STATUS.INTERNAL_SERVER_ERROR, 'DB_ERROR', 'An internal database error occurred.'));
  }
};

exports.createIcd10Code = async (req, res, next) => {
  try {
    const code = await prisma.icd10Code.create({ data: req.body });
    await AuditService.log(req.user.id, AUDIT_ACTIONS.CREATE, AUDIT_ENTITIES.ICD10, code.id);
    return sendSuccess(res, HTTP_STATUS.CREATED, code);
  } catch (error) {
    console.error("DB Error:", error);
    next(new ApiError(HTTP_STATUS.BAD_REQUEST, 'CREATE_FAILED', 'Failed to create ICD10 code.'));
  }
};

exports.getCptCodes = async (req, res, next) => {
  try {
    const codes = await prisma.cptCode.findMany();
    return sendSuccess(res, HTTP_STATUS.OK, codes);
  } catch (error) {
    console.error("DB Error:", error);
    next(new ApiError(HTTP_STATUS.INTERNAL_SERVER_ERROR, 'DB_ERROR', 'An internal database error occurred.'));
  }
};

exports.createCptCode = async (req, res, next) => {
  try {
    const code = await prisma.cptCode.create({ data: req.body });
    await AuditService.log(req.user.id, AUDIT_ACTIONS.CREATE, AUDIT_ENTITIES.CPT, code.id);
    return sendSuccess(res, HTTP_STATUS.CREATED, code);
  } catch (error) {
    console.error("DB Error:", error);
    next(new ApiError(HTTP_STATUS.BAD_REQUEST, 'CREATE_FAILED', 'Failed to create CPT code.'));
  }
};

exports.getModifiers = async (req, res, next) => {
  try {
    const modifiers = await prisma.modifier.findMany();
    return sendSuccess(res, HTTP_STATUS.OK, modifiers);
  } catch (error) {
    console.error("DB Error:", error);
    next(new ApiError(HTTP_STATUS.INTERNAL_SERVER_ERROR, 'DB_ERROR', 'An internal database error occurred.'));
  }
};

// ==========================================
// KAN-34, KAN-35: Payer Rules & Claim Edits
// ==========================================

exports.getPayerRules = async (req, res, next) => {
  try {
    const rules = await prisma.payerRule.findMany({
      where: { payerId: parseInt(req.params.payerId) }
    });
    return sendSuccess(res, HTTP_STATUS.OK, rules);
  } catch (error) {
    console.error("DB Error:", error);
    next(new ApiError(HTTP_STATUS.INTERNAL_SERVER_ERROR, 'DB_ERROR', 'An internal database error occurred.'));
  }
};

exports.createPayerRule = async (req, res, next) => {
  try {
    const rule = await prisma.payerRule.create({ data: req.body });
    await AuditService.log(req.user.id, AUDIT_ACTIONS.CREATE, AUDIT_ENTITIES.PAYER_RULE, rule.id);
    return sendSuccess(res, HTTP_STATUS.CREATED, rule);
  } catch (error) {
    console.error("DB Error:", error);
    next(new ApiError(HTTP_STATUS.BAD_REQUEST, 'CREATE_FAILED', 'Failed to create Payer Rule.'));
  }
};

exports.getClaimEditRules = async (req, res, next) => {
  try {
    const rules = await prisma.claimEditRule.findMany();
    return sendSuccess(res, HTTP_STATUS.OK, rules);
  } catch (error) {
    console.error("DB Error:", error);
    next(new ApiError(HTTP_STATUS.INTERNAL_SERVER_ERROR, 'DB_ERROR', 'An internal database error occurred.'));
  }
};

// ==========================================
// KAN-39: Rate References
// ==========================================
exports.getRateReferences = async (req, res, next) => {
  try {
    const rates = await prisma.rateReference.findMany();
    return sendSuccess(res, HTTP_STATUS.OK, rates);
  } catch (error) {
    console.error("DB Error:", error);
    next(new ApiError(HTTP_STATUS.INTERNAL_SERVER_ERROR, 'DB_ERROR', 'An internal database error occurred.'));
  }
};

exports.createRateReference = async (req, res, next) => {
  try {
    const rate = await prisma.rateReference.create({ data: req.body });
    await AuditService.log(req.user.id, AUDIT_ACTIONS.CREATE, AUDIT_ENTITIES.RATE_REFERENCE, rate.id);
    return sendSuccess(res, HTTP_STATUS.CREATED, rate);
  } catch (error) {
    console.error("DB Error:", error);
    next(new ApiError(HTTP_STATUS.BAD_REQUEST, 'CREATE_FAILED', 'Failed to create Rate Reference.'));
  }
};