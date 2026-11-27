const ProviderService = require('./provider.service');
const providerController = require('./provider.controller');
const providerRoutes = require('./provider.routes');

module.exports = {
  ProviderService,
  getProviderById: ProviderService.getProviderById.bind(ProviderService),
  providerController,
  providerRoutes,
};
