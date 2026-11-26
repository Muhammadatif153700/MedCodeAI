const HTTP_STATUS = require('../../constants/httpStatus');
const asyncHandler = require('../../utils/asyncHandler');
const { sendSuccess } = require('../../utils/ApiResponse');
const AuthService = require('./auth.service');

const register = asyncHandler(async (req, res) => {
  const user = await AuthService.register({
    name: req.body.name,
    email: req.body.email,
    password: req.body.password,
    ipAddress: req.ip,
  });

  return sendSuccess(res, HTTP_STATUS.CREATED, { user });
});

const login = asyncHandler(async (req, res) => {
  const result = await AuthService.login({
    email: req.body.email,
    password: req.body.password,
    ipAddress: req.ip,
  });

  return sendSuccess(res, HTTP_STATUS.OK, result);
});

const me = asyncHandler(async (req, res) => {
  return sendSuccess(res, HTTP_STATUS.OK, { user: req.user });
});

module.exports = {
  register,
  login,
  me,
};
