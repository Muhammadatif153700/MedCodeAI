const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const swaggerUi = require('swagger-ui-express');

const OPENAPI_PATH = path.resolve(__dirname, '../../docs/openapi.yaml');

let cachedSpec = null;

function loadOpenApiSpec() {
  if (!cachedSpec) {
    const raw = fs.readFileSync(OPENAPI_PATH, 'utf8');
    cachedSpec = yaml.load(raw);
  }
  return cachedSpec;
}

function isSwaggerEnabled(nodeEnv = process.env.NODE_ENV) {
  if (nodeEnv === 'production') {
    return process.env.ENABLE_SWAGGER_DOCS === 'true';
  }
  return true;
}

/**
 * Mounts Swagger UI (/api-docs) and OpenAPI JSON (/api-docs/openapi.json)
 * only when permitted by environment policy.
 * Never weakens global Helmet CSP on API routes.
 */
function mountSwaggerDocs(app, nodeEnv = process.env.NODE_ENV) {
  if (!isSwaggerEnabled(nodeEnv)) {
    return false;
  }

  const spec = loadOpenApiSpec();

  app.get('/api-docs/openapi.json', (_req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(200).send(JSON.stringify(spec));
  });

  app.use(
    '/api-docs',
    swaggerUi.serve,
    swaggerUi.setup(spec, {
      explorer: false,
      customSiteTitle: 'MedCodeAI KAN-4 API Documentation',
      swaggerOptions: {
        persistAuthorization: true,
      },
    })
  );

  return true;
}

module.exports = {
  OPENAPI_PATH,
  loadOpenApiSpec,
  isSwaggerEnabled,
  mountSwaggerDocs,
};
