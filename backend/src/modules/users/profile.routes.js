const express = require('express');
const { authenticate } = require('../../middleware/auth.middleware');
const validate = require('../../middleware/validate.middleware');
const { updateProfileSchema, changePasswordSchema } = require('./user.schemas');
const userController = require('./user.controller');

const router = express.Router();

router.use(authenticate);

router.get('/', userController.getProfile);
router.patch('/', validate(updateProfileSchema), userController.updateProfile);
router.patch('/password', validate(changePasswordSchema), userController.changePassword);

module.exports = router;
