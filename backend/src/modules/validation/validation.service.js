const prisma = require('../../config/prisma'); // Shared Prisma singleton
const axios = require('axios');
const env = require('../../config/env');
const ApiError = require('../../utils/ApiError');
const HTTP_STATUS = require('../../constants/httpStatus');

// KAN-41: Integrate Custom ML Service
exports.analyzeMedicalText = async (text) => {
  try {
    // Use actual ML API from env
    if (!env.ML_API_URL) {
        throw new Error("ML_API_URL is not configured in .env");
    }
    const response = await axios.post(env.ML_API_URL, { text });
    return response.data;
  } catch (error) {
    console.error("ML Service Error:", error.message);
    throw new ApiError(HTTP_STATUS.SERVICE_UNAVAILABLE, 'ML_SERVICE_FAILED', 'AI Analysis service is currently unavailable.');
  }
};

// KAN-40: Claim Validation Engine
exports.validateClaim = async (encounterId, mlOutput) => {
  const results = [];
  let overallStatus = "PASSED";

  const encounter = await prisma.encounter.findUnique({
    where: { id: encounterId },
    include: { payer: { include: { payerRules: true } }, plan: true }
  });

  if (!encounter) throw new ApiError(HTTP_STATUS.NOT_FOUND, 'NOT_FOUND', 'Encounter not found');

  if (encounter.plan && encounter.plan.authRequired) {
    results.push({
      ruleType: "AUTH_CHECK",
      status: "WARNING",
      message: "This insurance plan requires prior authorization.",
      modelVersion: "v1.0"
    });
    overallStatus = "WARNING";
  }

  const claimEdits = await prisma.claimEditRule.findMany();
  for (const cpt of mlOutput.cpt_codes) {
    const conflict = claimEdits.find(e => e.codeA === cpt.code);
    if (conflict) {
      results.push({
        ruleType: "CLAIM_EDIT",
        status: "FAILED",
        message: `CPT ${cpt.code} conflicts with rule: ${conflict.action}`,
        modelVersion: "v1.0"
      });
      overallStatus = "FAILED";
    }
  }

  for (const res of results) {
    await prisma.validationResult.create({
      data: {
        encounterId: encounterId,
        ruleType: res.ruleType,
        status: res.status,
        message: res.message,
        modelVersion: res.modelVersion
      }
    });
  }

  return { overallStatus, results };
};

// KAN-42: Denial Risk Analysis
exports.analyzeDenialRisk = async (encounterId, validationStatus, mlOutput) => {
  const risks = [];
  
  if (validationStatus === "FAILED") {
    risks.push({
      issue: "Claim validation failed",
      riskLevel: "HIGH",
      recommendedAction: "Fix validation errors before submitting."
    });
  }

  if (mlOutput.icd10_codes.length === 0) {
    risks.push({
      issue: "No diagnosis codes found",
      riskLevel: "MEDIUM",
      recommendedAction: "Add a valid ICD-10 code."
    });
  }

  for (const risk of risks) {
    await prisma.denialRisk.create({
      data: {
        encounterId: encounterId,
        issue: risk.issue,
        riskLevel: risk.riskLevel,
        recommendedAction: risk.recommendedAction
      }
    });
  }

  return risks;
};

// KAN-43: Reimbursement Estimate API
exports.getReimbursementEstimate = async (payerId, code, placeOfService) => {
  const rate = await prisma.rateReference.findFirst({
    where: {
      payerId: payerId,
      code: code,
      placeOfService: placeOfService
    }
  });

  if (!rate) return { found: false, amount: 0 };

  return {
    found: true,
    amount: rate.rate,
    code: rate.code,
    effectiveDate: rate.effectiveDate
  };
};