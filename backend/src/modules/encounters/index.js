const EncounterService = require('./encounter.service');
const encounterController = require('./encounter.controller');
const encounterRoutes = require('./encounter.routes');

module.exports = {
  EncounterService,
  getEncounterById: EncounterService.getEncounterById.bind(EncounterService),
  startCoding: EncounterService.startCoding.bind(EncounterService),
  markValidated: EncounterService.markValidated.bind(EncounterService),
  markClaimSubmitted: EncounterService.markClaimSubmitted.bind(EncounterService),
  closeEncounter: EncounterService.closeEncounter.bind(EncounterService),
  ALLOWED_ENCOUNTER_TRANSITIONS: EncounterService.ALLOWED_ENCOUNTER_TRANSITIONS,
  encounterController,
  encounterRoutes,
};
