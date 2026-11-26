const express = require('express');
const router = express.Router();
const controller = require('./payers.controller');

// Code Libraries
router.get('/icd10', controller.getIcd10Codes);
router.post('/icd10', controller.createIcd10Code);
router.get('/cpt', controller.getCptCodes);
router.post('/cpt', controller.createCptCode);
router.get('/modifiers', controller.getModifiers);

// Rules
router.get('/rules/:payerId', controller.getPayerRules);
router.post('/rules', controller.createPayerRule);
router.get('/claim-edits', controller.getClaimEditRules);

// Rates
router.get('/rates', controller.getRateReferences);
router.post('/rates', controller.createRateReference);

module.exports = router;