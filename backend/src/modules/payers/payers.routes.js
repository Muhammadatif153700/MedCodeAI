const express = require('express');
const { z } = require('zod');
const controller = require('./payers.controller');
const { authenticate } = require('../../middleware/auth.middleware');
const { authorize } = require('../../middleware/rbac.middleware');
const validate = require('../../middleware/validate.middleware');
const { ROLES } = require('../../constants/roles');

const router = express.Router();

const icd10Schema = {
  body: z.object({
    code: z.string().trim().min(1),
    description: z.string().trim().min(1),
  }),
};

const cptSchema = {
  body: z.object({
    code: z.string().trim().min(1),
    description: z.string().trim().min(1),
  }),
};

const payerRuleSchema = {
  body: z.object({
    payerId: z.number().int().positive(),
    planId: z.number().int().positive().optional(),
    ruleType: z.string().trim().min(1),
    ruleJson: z.any(),
    effectiveDate: z.coerce.date(),
  }),
};

const payerIdParamSchema = {
  params: z.object({
    payerId: z.coerce.number().int().positive(),
  }),
};

const rateSchema = {
  body: z.object({
    payerId: z.number().int().positive(),
    code: z.string().trim().min(1),
    placeOfService: z.string().trim().length(2),
    geoArea: z.string().trim().min(1),
    rate: z.number().nonnegative(),
    effectiveDate: z.coerce.date(),
  }),
};

// Code Libraries
router.get('/icd10', authenticate, authorize(ROLES.ADMIN, ROLES.CODER), controller.getIcd10Codes);
router.post('/icd10', authenticate, authorize(ROLES.ADMIN), validate(icd10Schema), controller.createIcd10Code);

router.get('/cpt', authenticate, authorize(ROLES.ADMIN, ROLES.CODER), controller.getCptCodes);
router.post('/cpt', authenticate, authorize(ROLES.ADMIN), validate(cptSchema), controller.createCptCode);

router.get('/modifiers', authenticate, authorize(ROLES.ADMIN, ROLES.CODER), controller.getModifiers);

// Rules & Rates
router.get(
  '/rules/:payerId',
  authenticate,
  authorize(ROLES.ADMIN, ROLES.BILLING_SPECIALIST),
  validate(payerIdParamSchema),
  controller.getPayerRules
);
router.post(
  '/rules',
  authenticate,
  authorize(ROLES.ADMIN),
  validate(payerRuleSchema),
  controller.createPayerRule
);
router.get(
  '/claim-edits',
  authenticate,
  authorize(ROLES.ADMIN, ROLES.CODER, ROLES.BILLING_SPECIALIST),
  controller.getClaimEditRules
);
router.get(
  '/rates',
  authenticate,
  authorize(ROLES.ADMIN, ROLES.BILLING_SPECIALIST),
  controller.getRateReferences
);
router.post(
  '/rates',
  authenticate,
  authorize(ROLES.ADMIN),
  validate(rateSchema),
  controller.createRateReference
);

module.exports = router;
