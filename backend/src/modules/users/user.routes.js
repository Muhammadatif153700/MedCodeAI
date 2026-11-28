const express = require('express');
const { ROLES } = require('../../constants/roles');
const { authenticate } = require('../../middleware/auth.middleware');
const { authorize } = require('../../middleware/rbac.middleware');
const validate = require('../../middleware/validate.middleware');
const {
  listUsersSchema,
  userIdSchema,
  approveUserSchema,
  rejectUserSchema,
  assignUserRoleSchema,
  updateUserStatusSchema,
} = require('./user.schemas');
const userController = require('./user.controller');

const router = express.Router();

router.use(authenticate, authorize(ROLES.ADMIN));

// Static routes registered before parameterized /:id routes
router.get('/pending', validate(listUsersSchema), userController.listPendingUsers);
router.get('/', validate(listUsersSchema), userController.listUsers);
router.get('/:id', validate(userIdSchema), userController.getUser);
router.patch('/:id/approve', validate(approveUserSchema), userController.approveUser);
router.patch('/:id/reject', validate(rejectUserSchema), userController.rejectUser);
router.patch('/:id/role', validate(assignUserRoleSchema), userController.assignRole);
router.patch('/:id/status', validate(updateUserStatusSchema), userController.updateStatus);

module.exports = router;
