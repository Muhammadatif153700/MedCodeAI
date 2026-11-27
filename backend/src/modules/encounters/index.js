const EncounterService = require('./encounter.service');
const encounterController = require('./encounter.controller');
const encounterRoutes = require('./encounter.routes');

module.exports = {
  EncounterService,
  getEncounterById: EncounterService.getEncounterById.bind(EncounterService),
  ALLOWED_ENCOUNTER_TRANSITIONS: EncounterService.ALLOWED_ENCOUNTER_TRANSITIONS,
  encounterController,
  encounterRoutes,
};
