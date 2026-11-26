const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const ApiError = require('../../utils/ApiError');
const HTTP_STATUS = require('../../constants/httpStatus');
const { sendSuccess } = require('../../utils/ApiResponse');

// ==========================================
// KAN-36, KAN-37, KAN-38: Code Libraries
// ==========================================

exports.getIcd10Codes = async (req, res, next) => {
  try {
    const codes = await prisma.icd10Code.findMany();
    return sendSuccess(res, HTTP_STATUS.OK, codes);
  } catch (error) {
    next(new ApiError(HTTP_STATUS.INTERNAL_SERVER_ERROR, 'DB_ERROR', error.message));
  }
};

exports.createIcd10Code = async (req, res, next) => {
  try {
    const code = await prisma.icd10Code.create({ data: req.body });
    return sendSuccess(res, HTTP_STATUS.CREATED, code);
  } catch (error) {
    next(new ApiError(HTTP_STATUS.BAD_REQUEST, 'CREATE_FAILED', error.message));
  }
};

exports.getCptCodes = async (req, res, next) => {
  try {
    const codes = await prisma.cptCode.findMany();
    return sendSuccess(res, HTTP_STATUS.OK, codes);
  } catch (error) {
    next(new ApiError(HTTP_STATUS.INTERNAL_SERVER_ERROR, 'DB_ERROR', error.message));
  }
};

exports.createCptCode = async (req, res, next) => {
  try {
    const code = await prisma.cptCode.create({ data: req.body });
    return sendSuccess(res, HTTP_STATUS.CREATED, code);
  } catch (error) {
    next(new ApiError(HTTP_STATUS.BAD_REQUEST, 'CREATE_FAILED', error.message));
  }
};

exports.getModifiers = async (req, res, next) => {
  try {
    const modifiers = await prisma.modifier.findMany();
    return sendSuccess(res, HTTP_STATUS.OK, modifiers);
  } catch (error) {
    next(new ApiError(HTTP_STATUS.INTERNAL_SERVER_ERROR, 'DB_ERROR', error.message));
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
    next(new ApiError(HTTP_STATUS.INTERNAL_SERVER_ERROR, 'DB_ERROR', error.message));
  }
};

exports.createPayerRule = async (req, res, next) => {
  try {
    const rule = await prisma.payerRule.create({ data: req.body });
    return sendSuccess(res, HTTP_STATUS.CREATED, rule);
  } catch (error) {
    next(new ApiError(HTTP_STATUS.BAD_REQUEST, 'CREATE_FAILED', error.message));
  }
};

exports.getClaimEditRules = async (req, res, next) => {
  try {
    const rules = await prisma.claimEditRule.findMany();
    return sendSuccess(res, HTTP_STATUS.OK, rules);
  } catch (error) {
    next(new ApiError(HTTP_STATUS.INTERNAL_SERVER_ERROR, 'DB_ERROR', error.message));
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
    next(new ApiError(HTTP_STATUS.INTERNAL_SERVER_ERROR, 'DB_ERROR', error.message));
  }
};

exports.createRateReference = async (req, res, next) => {
  try {
    const rate = await prisma.rateReference.create({ data: req.body });
    return sendSuccess(res, HTTP_STATUS.CREATED, rate);
  } catch (error) {
    next(new ApiError(HTTP_STATUS.BAD_REQUEST, 'CREATE_FAILED', error.message));
  }
};