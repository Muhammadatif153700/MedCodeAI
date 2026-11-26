const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// KAN-41: Integrate Custom ML Service
exports.analyzeMedicalText = async (text) => {
  try {
    return {
      icd10_codes: [{ code: "E11.9", description: "Type 2 diabetes", supportingText: "Patient has diabetes", reason: "Documented" }],
      cpt_codes: [{ code: "99213", description: "Office visit", supportingText: "Checked blood sugar", reason: "Standard visit", units: 1 }],
      modifiers: [{ code: "25" }]
    };
  } catch (error) {
    throw new Error("ML Analysis failed");
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

  if (!encounter) throw new Error("Encounter not found");

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