const express = require('express');
const { ROLES } = require('../../constants/roles');
const { authenticate } = require('../../middleware/auth.middleware');
const { authorize } = require('../../middleware/rbac.middleware');
const validate = require('../../middleware/validate.middleware');
const {
  createEncounterSchema,
  updateEncounterSchema,
  encounterIdSchema,
  listEncountersSchema,
} = require('./encounter.schemas');
const encounterController = require('./encounter.controller');

const router = express.Router();

const ALLOWED_ROLES = [ROLES.ADMIN, ROLES.BILLING_SPECIALIST, ROLES.CODER];

router.use(authenticate, authorize(...ALLOWED_ROLES));

router.post('/', validate(createEncounterSchema), encounterController.createEncounter);
router.get('/', validate(listEncountersSchema), encounterController.listEncounters);
router.get('/:id', validate(encounterIdSchema), encounterController.getEncounter);
router.patch('/:id', validate(updateEncounterSchema), encounterController.updateEncounter);
router.delete('/:id', validate(encounterIdSchema), encounterController.deleteEncounter);

module.exports = router;
