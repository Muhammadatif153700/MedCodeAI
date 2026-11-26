const express = require('express');
const router = express.Router();
const validationService = require('./validation.service');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const ApiError = require('../../utils/ApiError');
const HTTP_STATUS = require('../../constants/httpStatus');
const { sendSuccess } = require('../../utils/ApiResponse');

router.post('/process-encounter', async (req, res, next) => {
  try {
    const { encounterId, rawText, placeOfService } = req.body;

    if (!encounterId || !rawText) {
      throw new ApiError(HTTP_STATUS.BAD_REQUEST, 'MISSING_FIELDS', 'encounterId and rawText are required');
    }

    const mlOutput = await validationService.analyzeMedicalText(rawText);
    const validation = await validationService.validateClaim(encounterId, mlOutput);
    const risks = await validationService.analyzeDenialRisk(encounterId, validation.overallStatus, mlOutput);

    const encounter = await prisma.encounter.findUnique({ where: { id: encounterId }});
    if (!encounter) {
      throw new ApiError(HTTP_STATUS.NOT_FOUND, 'ENCOUNTER_NOT_FOUND', 'Encounter not found');
    }

    const estimate = await validationService.getReimbursementEstimate(
      encounter.payerId, 
      mlOutput.cpt_codes[0].code, 
      placeOfService || "11"
    );

    return sendSuccess(res, HTTP_STATUS.OK, {
      message: "Processing complete",
      mlSuggestions: mlOutput,
      validation: validation,
      denialRisks: risks,
      financialEstimate: estimate
    });

  } catch (error) {
    next(error);
  }
});

module.exports = router;