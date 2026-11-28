const express = require('express');
const { ROLES } = require('../../constants/roles');
const { authenticate } = require('../../middleware/auth.middleware');
const { authorize } = require('../../middleware/rbac.middleware');
const validate = require('../../middleware/validate.middleware');
const {
  createPatientSchema,
  updatePatientSchema,
  patientIdSchema,
  listPatientsSchema,
} = require('./patient.schemas');
const patientController = require('./patient.controller');

const router = express.Router();

const ALLOWED_ROLES = [ROLES.ADMIN, ROLES.BILLING_SPECIALIST, ROLES.CODER];

router.use(authenticate, authorize(...ALLOWED_ROLES));

router.post('/', validate(createPatientSchema), patientController.createPatient);
router.get('/', validate(listPatientsSchema), patientController.listPatients);
router.get('/:id', validate(patientIdSchema), patientController.getPatient);
router.patch('/:id', validate(updatePatientSchema), patientController.updatePatient);
router.delete('/:id', validate(patientIdSchema), patientController.deletePatient);

module.exports = router;
