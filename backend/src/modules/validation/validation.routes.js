const express = require('express');
const { z } = require('zod');
const validationService = require('./validation.service');
const { prisma } = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');
const HTTP_STATUS = require('../../constants/httpStatus');
const { sendSuccess } = require('../../utils/ApiResponse');
const asyncHandler = require('../../utils/asyncHandler');
const validate = require('../../middleware/validate.middleware');
const { authenticate } = require('../../middleware/auth.middleware');
const { authorize } = require('../../middleware/rbac.middleware');
const { ROLES } = require('../../constants/roles');
const { AuditService, AUDIT_ACTIONS, AUDIT_ENTITIES } = require('../audit');
const { markValidated } = require('../encounters');
const encounterRepository = require('../encounters/encounter.repository');

const router = express.Router();

const processEncounterSchema = {
  body: z.object({
    encounterId: z.number().int().positive(),
    rawText: z.string().trim().min(5),
    placeOfService: z.string().trim().length(2).optional(),
  }),
};

router.post(
  '/process-encounter',
  authenticate,
  authorize(ROLES.ADMIN, ROLES.CODER, ROLES.BILLING_SPECIALIST),
  validate(processEncounterSchema),
  asyncHandler(async (req, res) => {
    const { encounterId, rawText, placeOfService } = req.body;

    // Pre-check encounter & coding snapshot before external ML call (never hold DB tx open over network)
    const preEncounter = await prisma.encounter.findUnique({ where: { id: encounterId } });
    if (!preEncounter) {
      throw new ApiError(HTTP_STATUS.NOT_FOUND, 'ENCOUNTER_NOT_FOUND', 'Encounter not found');
    }
    const preSnapshot = await encounterRepository.countValidationPrerequisites(encounterId, prisma);

    const mlOutput = await validationService.analyzeMedicalText(rawText);

    const outcome = await prisma.$transaction(
      async (tx) => {
        const encounter = await tx.encounter.findUnique({ where: { id: encounterId } });
        if (!encounter) {
          throw new ApiError(HTTP_STATUS.NOT_FOUND, 'ENCOUNTER_NOT_FOUND', 'Encounter not found');
        }
        const currentSnapshot = await encounterRepository.countValidationPrerequisites(
          encounterId,
          tx
        );
        if (
          encounter.status !== preEncounter.status ||
          currentSnapshot.acceptedSuggestions !== preSnapshot.acceptedSuggestions ||
          currentSnapshot.pendingSuggestions !== preSnapshot.pendingSuggestions
        ) {
          throw new ApiError(
            HTTP_STATUS.CONFLICT,
            'CONCURRENT_MODIFICATION',
            'Encounter or coding suggestions changed during ML analysis; please retry validation'
          );
        }

        const validation = await validationService.validateClaim(encounterId, mlOutput, tx);
        const risks = await validationService.analyzeDenialRisk(
          encounterId,
          validation.overallStatus,
          mlOutput,
          tx
        );

        const primaryCpt = mlOutput.cpt_codes[0] ? mlOutput.cpt_codes[0].code : null;
        const estimate = primaryCpt
          ? await validationService.getReimbursementEstimate(
              encounter.payerId,
              primaryCpt,
              placeOfService || encounter.placeOfService || '11',
              tx
            )
          : { found: false, amount: 0 };

        await AuditService.log(
          {
            userId: req.user.id,
            action: AUDIT_ACTIONS.CLAIM_VALIDATED,
            entity: AUDIT_ENTITIES.ENCOUNTER,
            entityId: encounterId,
            ipAddress: req.ip,
          },
          { tx }
        );

        let encounterStatus = encounter.status;
        let lifecycleUpdated = false;

        if (encounter.status === 'CODING_IN_PROGRESS' && validation.overallStatus !== 'FAILED') {
          const prereqs = await encounterRepository.countValidationPrerequisites(encounterId, tx);
          if (
            prereqs.acceptedSuggestions >= 1 &&
            prereqs.pendingSuggestions === 0 &&
            prereqs.failedValidations === 0
          ) {
            const updated = await markValidated(
              encounterId,
              {
                userId: req.user.id,
                role: req.user.role,
                ipAddress: req.ip,
              },
              { tx }
            );
            encounterStatus = updated.status;
            lifecycleUpdated = true;
          }
        }

        return {
          mlSuggestions: mlOutput,
          validation,
          denialRisks: risks,
          financialEstimate: estimate,
          encounterStatus,
          lifecycleUpdated,
        };
      },
      { isolationLevel: 'Serializable' }
    );

    return sendSuccess(res, HTTP_STATUS.OK, {
      message: 'Processing complete',
      ...outcome,
    });
  })
);

module.exports = router;
