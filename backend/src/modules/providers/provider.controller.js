const HTTP_STATUS = require('../../constants/httpStatus');
const asyncHandler = require('../../utils/asyncHandler');
const { sendSuccess } = require('../../utils/ApiResponse');
const ProviderService = require('./provider.service');

const createProvider = asyncHandler(async (req, res) => {
  const provider = await ProviderService.createProvider(req.body, {
    userId: req.user.id,
    ipAddress: req.ip,
  });
  return sendSuccess(res, HTTP_STATUS.CREATED, { provider });
});

const listProviders = asyncHandler(async (req, res) => {
  const { items, meta } = await ProviderService.listProviders(req.query);
  return sendSuccess(res, HTTP_STATUS.OK, items, meta);
});

const getProvider = asyncHandler(async (req, res) => {
  const provider = await ProviderService.getProviderById(req.params.id);
  return sendSuccess(res, HTTP_STATUS.OK, { provider });
});

const updateProvider = asyncHandler(async (req, res) => {
  const provider = await ProviderService.updateProvider(req.params.id, req.body, {
    userId: req.user.id,
    ipAddress: req.ip,
  });
  return sendSuccess(res, HTTP_STATUS.OK, { provider });
});

const deleteProvider = asyncHandler(async (req, res) => {
  const provider = await ProviderService.deleteProvider(req.params.id, {
    userId: req.user.id,
    ipAddress: req.ip,
  });
  return sendSuccess(res, HTTP_STATUS.OK, { deleted: true, provider });
});

module.exports = {
  createProvider,
  listProviders,
  getProvider,
  updateProvider,
  deleteProvider,
};
