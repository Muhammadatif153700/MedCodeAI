const HTTP_STATUS = require('../../constants/httpStatus');
const asyncHandler = require('../../utils/asyncHandler');
const { sendSuccess } = require('../../utils/ApiResponse');
const EncounterService = require('./encounter.service');

const createEncounter = asyncHandler(async (req, res) => {
  const encounter = await EncounterService.createEncounter(req.body, {
    userId: req.user.id,
    ipAddress: req.ip,
  });
  return sendSuccess(res, HTTP_STATUS.CREATED, { encounter });
});

const listEncounters = asyncHandler(async (req, res) => {
  const { items, meta } = await EncounterService.listEncounters(req.query);
  return sendSuccess(res, HTTP_STATUS.OK, items, meta);
});

const getEncounter = asyncHandler(async (req, res) => {
  const encounter = await EncounterService.getEncounterById(req.params.id);
  return sendSuccess(res, HTTP_STATUS.OK, { encounter });
});

const updateEncounter = asyncHandler(async (req, res) => {
  const encounter = await EncounterService.updateEncounter(req.params.id, req.body, {
    userId: req.user.id,
    ipAddress: req.ip,
  });
  return sendSuccess(res, HTTP_STATUS.OK, { encounter });
});

const deleteEncounter = asyncHandler(async (req, res) => {
  const encounter = await EncounterService.deleteEncounter(req.params.id, {
    userId: req.user.id,
    ipAddress: req.ip,
  });
  return sendSuccess(res, HTTP_STATUS.OK, { deleted: true, encounter });
});

module.exports = {
  createEncounter,
  listEncounters,
  getEncounter,
  updateEncounter,
  deleteEncounter,
};
