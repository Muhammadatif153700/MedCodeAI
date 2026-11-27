const axios = require('axios');
const { prisma } = require('../../config/prisma');
const { env } = require('../../config/env');
const ApiError = require('../../utils/ApiError');
const HTTP_STATUS = require('../../constants/httpStatus');

// KAN-41: Integrate Custom ML Service
exports.analyzeMedicalText = async (text) => {
  if (!env.ML_API_URL) {
    throw new ApiError(
      HTTP_STATUS.SERVICE_UNAVAILABLE,
      'ML_SERVICE_UNAVAILABLE',
      'AI Analysis service is not configured.'
    );
  }

  let response;
  try {
    response = await axios.post(
      env.ML_API_URL,
      { text },
      { timeout: env.ML_API_TIMEOUT_MS }
    );
  } catch (_error) {
    throw new ApiError(
      HTTP_STATUS.SERVICE_UNAVAILABLE,
      'ML_SERVICE_FAILED',
      'AI Analysis service is currently unavailable.'
    );
  }

  const data = response && response.data;
  if (
    !data ||
    typeof data !== 'object' ||
    !Array.isArray(data.cpt_codes) ||
    !Array.isArray(data.icd10_codes)
  ) {
    throw new ApiError(
      HTTP_STATUS.BAD_GATEWAY,
      'ML_INVALID_RESPONSE',
      'AI Analysis service returned an invalid response payload.'
    );
  }

  return data;
};

// KAN-40: Claim Validation Engine
exports.validateClaim = async (encounterId, mlOutput, dbClient = prisma) => {
  const results = [];
  let overallStatus = 'PASSED';

  const encounter = await dbClient.encounter.findUnique({
    where: { id: encounterId },
    include: { payer: { include: { payerRules: true } }, plan: true },
  });

  if (!encounter) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'ENCOUNTER_NOT_FOUND', 'Encounter not found');
  }

  if (encounter.plan && encounter.plan.authRequired) {
    results.push({
      ruleType: 'AUTH_CHECK',
      status: 'WARNING',
      message: 'This insurance plan requires prior authorization.',
      modelVersion: 'v1.0',
    });
    overallStatus = 'WARNING';
  }

  const claimEdits = await dbClient.claimEditRule.findMany();
  for (const cpt of mlOutput.cpt_codes || []) {
    const conflict = claimEdits.find((e) => e.codeA === cpt.code);
    if (conflict) {
      results.push({
        ruleType: 'CLAIM_EDIT',
        status: 'FAILED',
        message: `CPT ${cpt.code} conflicts with rule: ${conflict.action}`,
        modelVersion: 'v1.0',
      });
      overallStatus = 'FAILED';
    }
  }

  if (results.length === 0) {
    results.push({
      ruleType: 'CLAIM_EDIT',
      status: 'PASSED',
      message: 'All claim validation checks passed.',
      modelVersion: 'v1.0',
    });
  }

  for (const res of results) {
    await dbClient.validationResult.create({
      data: {
        encounterId,
        ruleType: res.ruleType,
        status: res.status,
        message: res.message,
        modelVersion: res.modelVersion,
      },
    });
  }

  return { overallStatus, results };
};

// KAN-42: Denial Risk Analysis
exports.analyzeDenialRisk = async (
  encounterId,
  validationStatus,
  mlOutput,
  dbClient = prisma
) => {
  const risks = [];

  if (validationStatus === 'FAILED') {
    risks.push({
      issue: 'Claim validation failed',
      riskLevel: 'HIGH',
      recommendedAction: 'Fix validation errors before submitting.',
    });
  }

  if (!mlOutput.icd10_codes || mlOutput.icd10_codes.length === 0) {
    risks.push({
      issue: 'No diagnosis codes found',
      riskLevel: 'MEDIUM',
      recommendedAction: 'Add a valid ICD-10 code.',
    });
  }

  for (const risk of risks) {
    await dbClient.denialRisk.create({
      data: {
        encounterId,
        issue: risk.issue,
        riskLevel: risk.riskLevel,
        recommendedAction: risk.recommendedAction,
      },
    });
  }

  return risks;
};

// KAN-43: Reimbursement Estimate API
exports.getReimbursementEstimate = async (
  payerId,
  code,
  placeOfService,
  dbClient = prisma
) => {
  const rate = await dbClient.rateReference.findFirst({
    where: {
      payerId,
      code,
      placeOfService,
    },
  });

  if (!rate) return { found: false, amount: 0 };

  return {
    found: true,
    amount: rate.rate,
    code: rate.code,
    effectiveDate: rate.effectiveDate,
  };
};
