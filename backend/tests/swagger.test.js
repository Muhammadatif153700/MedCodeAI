const express = require('express');
const request = require('supertest');
const app = require('../src/app');
const {
  loadOpenApiSpec,
  isSwaggerEnabled,
  mountSwaggerDocs,
} = require('../src/config/swagger');

describe('OpenAPI Specification & Swagger UI (Phase 9E)', () => {
  test('Loads backend/docs/openapi.yaml and covers all 32 KAN-4 endpoints without exposing sensitive fields', () => {
    const validated = loadOpenApiSpec();
    expect(validated.openapi).toBe('3.0.3');
    expect(validated.info.title).toBe('MedCodeAI Backend API (KAN-4)');

    const expectedOperations = [
      ['get', '/health'],
      ['get', '/health/db'],
      ['post', '/auth/register'],
      ['post', '/auth/login'],
      ['get', '/auth/me'],
      ['get', '/profile'],
      ['patch', '/profile'],
      ['patch', '/profile/password'],
      ['get', '/users/pending'],
      ['get', '/users'],
      ['get', '/users/{id}'],
      ['patch', '/users/{id}/approve'],
      ['patch', '/users/{id}/reject'],
      ['patch', '/users/{id}/role'],
      ['patch', '/users/{id}/status'],
      ['get', '/roles'],
      ['get', '/audit-logs'],
      ['post', '/patients'],
      ['get', '/patients'],
      ['get', '/patients/{id}'],
      ['patch', '/patients/{id}'],
      ['delete', '/patients/{id}'],
      ['post', '/providers'],
      ['get', '/providers'],
      ['get', '/providers/{id}'],
      ['patch', '/providers/{id}'],
      ['delete', '/providers/{id}'],
      ['post', '/encounters'],
      ['get', '/encounters'],
      ['get', '/encounters/{id}'],
      ['patch', '/encounters/{id}'],
      ['delete', '/encounters/{id}'],
    ];

    let totalOps = 0;
    for (const [pathKey, pathObj] of Object.entries(validated.paths)) {
      for (const method of ['get', 'post', 'patch', 'put', 'delete']) {
        if (pathObj[method]) totalOps += 1;
      }
    }
    expect(totalOps).toBe(expectedOperations.length);

    for (const [method, pathKey] of expectedOperations) {
      expect(validated.paths[pathKey]).toBeDefined();
      expect(validated.paths[pathKey][method]).toBeDefined();
    }

    // Ensure sensitive internal fields are not exposed in UserPublic schema
    const userPublicProps = Object.keys(validated.components.schemas.UserPublic.properties);
    expect(userPublicProps).not.toContain('passwordHash');
    expect(userPublicProps).not.toContain('tokenVersion');
  });

  test('Serves /api-docs/openapi.json and /api-docs/ in non-production environments', async () => {
    const jsonRes = await request(app).get('/api-docs/openapi.json');
    expect(jsonRes.status).toBe(200);
    expect(jsonRes.body.openapi).toBe('3.0.3');
    expect(jsonRes.body.paths['/health']).toBeDefined();

    const uiRes = await request(app).get('/api-docs/');
    expect(uiRes.status).toBe(200);
    expect(uiRes.text).toContain('MedCodeAI KAN-4 API Documentation');
    expect(uiRes.text).toContain('id="swagger-ui"');
  });

  test('Disables Swagger UI and OpenAPI JSON in production even if ENABLE_SWAGGER_DOCS=true', async () => {
    const prevFlag = process.env.ENABLE_SWAGGER_DOCS;
    process.env.ENABLE_SWAGGER_DOCS = 'true';
    try {
      expect(isSwaggerEnabled('production')).toBe(false);
      const prodApp = express();
      expect(mountSwaggerDocs(prodApp, 'production')).toBe(false);
      expect((await request(prodApp).get('/api-docs/')).status).toBe(404);
      expect((await request(prodApp).get('/api-docs/openapi.json')).status).toBe(404);
      expect(loadOpenApiSpec().info.version).toBe('1.0.0');
    } finally {
      if (prevFlag !== undefined) {
        process.env.ENABLE_SWAGGER_DOCS = prevFlag;
      } else {
        delete process.env.ENABLE_SWAGGER_DOCS;
      }
    }
  });
});
