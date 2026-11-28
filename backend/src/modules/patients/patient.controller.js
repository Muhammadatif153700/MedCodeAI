const HTTP_STATUS = require('../../constants/httpStatus');
const asyncHandler = require('../../utils/asyncHandler');
const { sendSuccess } = require('../../utils/ApiResponse');
const PatientService = require('./patient.service');

const createPatient = asyncHandler(async (req, res) => {
  const patient = await PatientService.createPatient(req.body, {
    userId: req.user.id,
    ipAddress: req.ip,
  });
  return sendSuccess(res, HTTP_STATUS.CREATED, { patient });
});

const listPatients = asyncHandler(async (req, res) => {
  const { items, meta } = await PatientService.listPatients(req.query);
  return sendSuccess(res, HTTP_STATUS.OK, items, meta);
});

const getPatient = asyncHandler(async (req, res) => {
  const patient = await PatientService.getPatientById(req.params.id);
  return sendSuccess(res, HTTP_STATUS.OK, { patient });
});

const updatePatient = asyncHandler(async (req, res) => {
  const patient = await PatientService.updatePatient(req.params.id, req.body, {
    userId: req.user.id,
    ipAddress: req.ip,
  });
  return sendSuccess(res, HTTP_STATUS.OK, { patient });
});

const deletePatient = asyncHandler(async (req, res) => {
  const patient = await PatientService.deletePatient(req.params.id, {
    userId: req.user.id,
    ipAddress: req.ip,
  });
  return sendSuccess(res, HTTP_STATUS.OK, { deleted: true, patient });
});

module.exports = {
  createPatient,
  listPatients,
  getPatient,
  updatePatient,
  deletePatient,
};
