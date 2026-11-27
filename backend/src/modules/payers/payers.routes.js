const express = require('express');
const router = express.Router();
const { z } = require('zod');
const controller = require('./payers.controller');
const { authenticate } = require('../../middleware/auth.middleware');
const { authorize } = require('../../middleware/rbac.middleware');
const { ROLES } = require('../../constants/roles');

// Zod Schemas
const icd10Schema = z.object({ code: z.string().min(1), description: z.string().min(1) });
const cptSchema = z.object({ code: z.string().min(1), description: z.string().min(1) });
const payerRuleSchema = z.object({
  payerId: z.number().int(),
  planId: z.number().int().optional(),
  ruleType: z.string().min(1),
  ruleJson: z.any(),
  effectiveDate: z.string().transform((str) => new Date(str))
});
const rateSchema = z.object({
  payerId: z.number().int(),
  code: z.string().min(1),
  placeOfService: z.string().length(2),
  geoArea: z.string().min(1),
  rate: z.number(),
  effectiveDate: z.string().transform((str) => new Date(str))
});

// A simple validator (you can swap to shared validate middleware later if they have one)
const validate = (schema) => (req, res, next) => {
  try {
    schema.parse(req.body);
    next();
  } catch (error) {
    return res.status(400).json({ error: error.errors });
  }
};

// Code Libraries
router.get('/icd10', authenticate, authorize([ROLES.ADMIN, ROLES.CODER]), controller.getIcd10Codes);
router.post('/icd10', authenticate, authorize([ROLES.ADMIN]), validate(icd10Schema), controller.createIcd10Code);

router.get('/cpt', authenticate, authorize([ROLES.ADMIN, ROLES.CODER]), controller.getCptCodes);
router.post('/cpt', authenticate, authorize([ROLES.ADMIN]), validate(cptSchema), controller.createCptCode);

router.get('/modifiers', authenticate, authorize([ROLES.ADMIN, ROLES.CODER]), controller.getModifiers);

// Rules & Rates
router.get('/rules/:payerId', authenticate, authorize([ROLES.ADMIN, ROLES.BILLING_SPECIALIST]), controller.getPayerRules);
router.post('/rules', authenticate, authorize([ROLES.ADMIN]), validate(payerRuleSchema), controller.createPayerRule);
router.get('/claim-edits', authenticate, authorize([ROLES.ADMIN, ROLES.CODER, ROLES.BILLING_SPECIALIST]), controller.getClaimEditRules);
router.get('/rates', authenticate, authorize([ROLES.ADMIN, ROLES.BILLING_SPECIALIST]), controller.getRateReferences);
router.post('/rates', authenticate, authorize([ROLES.ADMIN]), validate(rateSchema), controller.createRateReference);

module.exports = router;