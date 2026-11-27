const UserService = require('./user.service');
const userController = require('./user.controller');
const userRoutes = require('./user.routes');
const profileRoutes = require('./profile.routes');

module.exports = {
  UserService,
  userController,
  userRoutes,
  profileRoutes,
};
