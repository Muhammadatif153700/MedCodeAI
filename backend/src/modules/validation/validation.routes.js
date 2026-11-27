const express = require('express');
const router = express.Router();
const { z } = require('zod');
const validationService = require('./validation.service');
const prisma = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');
const HTTP_STATUS = require('../../constants/httpStatus');
const { sendSuccess } = require('../../utils/ApiResponse');
const { authenticate } = require('../../middleware/auth.middleware');
const { authorize } = require('../../middleware/rbac.middleware');
const { ROLES } = require('../../constants/roles');

const processEncounterSchema = z.object({
  encounterId: z.number().int().positive(),
  rawText: z.string().min(5),
  placeOfService: z.string().length(2).optional()
});

const validate = (schema) => (req, res, next) => {
  try {
    schema.parse(req.body);
    next();
  } catch (error) {
    return res.status(400).json({ error: error.errors });
  }
};

router.post(
  '/process-encounter', 
  authenticate, 
  authorize([ROLES.ADMIN, ROLES.CODER, ROLES.BILLING_SPECIALIST]), 
  validate(processEncounterSchema),
  async (req, res, next) => {
    try {
      const { encounterId, rawText, placeOfService } = req.body;

      const mlOutput = await validationService.analyzeMedicalText(rawText);
      const validation = await validationService.validateClaim(encounterId, mlOutput);
      const risks = await validationService.analyzeDenialRisk(encounterId, validation.overallStatus, mlOutput);

      const encounter = await prisma.encounter.findUnique({ where: { id: encounterId }});
      if (!encounter) {
        throw new ApiError(HTTP_STATUS.NOT_FOUND, 'NOT_FOUND', 'Encounter not found');
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
  }
);

module.exports = router;