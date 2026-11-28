const HTTP_STATUS = require('../../constants/httpStatus');
const asyncHandler = require('../../utils/asyncHandler');
const { sendSuccess } = require('../../utils/ApiResponse');
const UserService = require('./user.service');

const listUsers = asyncHandler(async (req, res) => {
  const { items, meta } = await UserService.listUsers(req.query);
  return sendSuccess(res, HTTP_STATUS.OK, items, meta);
});

const listPendingUsers = asyncHandler(async (req, res) => {
  const { items, meta } = await UserService.listPendingUsers(req.query);
  return sendSuccess(res, HTTP_STATUS.OK, items, meta);
});

const getUser = asyncHandler(async (req, res) => {
  const user = await UserService.getUserById(req.params.id);
  return sendSuccess(res, HTTP_STATUS.OK, { user });
});

const listRoles = asyncHandler(async (_req, res) => {
  const roles = await UserService.listRoles();
  return sendSuccess(res, HTTP_STATUS.OK, roles);
});

const approveUser = asyncHandler(async (req, res) => {
  const user = await UserService.approveUser(req.params.id, req.body, {
    userId: req.user.id,
    ipAddress: req.ip,
  });
  return sendSuccess(res, HTTP_STATUS.OK, { user });
});

const rejectUser = asyncHandler(async (req, res) => {
  const user = await UserService.rejectUser(req.params.id, {
    userId: req.user.id,
    ipAddress: req.ip,
  });
  return sendSuccess(res, HTTP_STATUS.OK, { user });
});

const assignRole = asyncHandler(async (req, res) => {
  const user = await UserService.assignRole(req.params.id, req.body, {
    userId: req.user.id,
    ipAddress: req.ip,
  });
  return sendSuccess(res, HTTP_STATUS.OK, { user });
});

const updateStatus = asyncHandler(async (req, res) => {
  const user = await UserService.updateStatus(req.params.id, req.body, {
    userId: req.user.id,
    ipAddress: req.ip,
  });
  return sendSuccess(res, HTTP_STATUS.OK, { user });
});

const getProfile = asyncHandler(async (req, res) => {
  const user = await UserService.getUserById(req.user.id);
  return sendSuccess(res, HTTP_STATUS.OK, { user });
});

const updateProfile = asyncHandler(async (req, res) => {
  const user = await UserService.updateProfile(req.user.id, req.body, {
    userId: req.user.id,
    ipAddress: req.ip,
  });
  return sendSuccess(res, HTTP_STATUS.OK, { user });
});

const changePassword = asyncHandler(async (req, res) => {
  const result = await UserService.changePassword(req.user.id, req.body, {
    userId: req.user.id,
    ipAddress: req.ip,
  });
  return sendSuccess(res, HTTP_STATUS.OK, result);
});

module.exports = {
  listUsers,
  listPendingUsers,
  getUser,
  listRoles,
  approveUser,
  rejectUser,
  assignRole,
  updateStatus,
  getProfile,
  updateProfile,
  changePassword,
};
