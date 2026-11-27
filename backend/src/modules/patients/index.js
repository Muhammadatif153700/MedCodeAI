const PatientService = require('./patient.service');
const patientController = require('./patient.controller');
const patientRoutes = require('./patient.routes');

module.exports = {
  PatientService,
  getPatientById: PatientService.getPatientById.bind(PatientService),
  patientController,
  patientRoutes,
};
