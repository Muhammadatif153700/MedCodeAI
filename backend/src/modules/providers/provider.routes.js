const express = require('express');
const { ROLES } = require('../../constants/roles');
const { authenticate } = require('../../middleware/auth.middleware');
const { authorize } = require('../../middleware/rbac.middleware');
const validate = require('../../middleware/validate.middleware');
const {
  createProviderSchema,
  updateProviderSchema,
  providerIdSchema,
  listProvidersSchema,
} = require('./provider.schemas');
const providerController = require('./provider.controller');

const router = express.Router();

const ALLOWED_ROLES = [ROLES.ADMIN, ROLES.BILLING_SPECIALIST, ROLES.CODER];

router.use(authenticate, authorize(...ALLOWED_ROLES));

router.post('/', validate(createProviderSchema), providerController.createProvider);
router.get('/', validate(listProvidersSchema), providerController.listProviders);
router.get('/:id', validate(providerIdSchema), providerController.getProvider);
router.patch('/:id', validate(updateProviderSchema), providerController.updateProvider);
router.delete('/:id', validate(providerIdSchema), providerController.deleteProvider);

module.exports = router;
