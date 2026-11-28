const SwaggerParser = require('@apidevtools/swagger-parser');
const { OPENAPI_PATH } = require('../src/config/swagger');

SwaggerParser.validate(OPENAPI_PATH)
  .then((api) => {
    const opCount = Object.values(api.paths).reduce(
      (sum, pathObj) =>
        sum +
        ['get', 'post', 'patch', 'put', 'delete'].filter((m) => Boolean(pathObj[m])).length,
      0
    );
    console.log(`OpenAPI valid: ${api.info.title} v${api.info.version} (${opCount} operations)`);
  })
  .catch((err) => {
    console.error('OpenAPI validation failed:', err.message);
    process.exit(1);
  });
