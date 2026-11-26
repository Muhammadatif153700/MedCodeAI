const request = require('supertest');
const app = require('../src/app');

describe('MedCodeAI Express Application', () => {
  test('1. Health endpoint returns HTTP 200', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
  });

  test('2. Health response follows the agreed response format', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.body).toEqual({
      success: true,
      data: {
        service: 'MedCodeAI API',
        status: 'ok',
      },
    });
  });

  test('3 & 4. Unknown routes return HTTP 404 with agreed error format', async () => {
    const res = await request(app).get('/api/v1/non-existent-route');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      success: false,
      error: {
        code: 'ROUTE_NOT_FOUND',
        message: 'Route not found: GET /api/v1/non-existent-route',
      },
    });
  });

  test('5. Security headers are present and X-Powered-By is disabled', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  test('6. Request IDs are generated on every response', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  test('7. Invalid JSON is handled safely with HTTP 400 and standard error format', async () => {
    const res = await request(app)
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send('{"invalid": ');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      success: false,
      error: {
        code: 'INVALID_JSON',
        message: 'Malformed JSON payload in request body',
      },
    });
  });

  test('10. CORS allows configured origin and rejects unconfigured origin', async () => {
    const allowedRes = await request(app)
      .get('/api/v1/health')
      .set('Origin', 'http://localhost:3000');

    expect(allowedRes.status).toBe(200);
    expect(allowedRes.headers['access-control-allow-origin']).toBe(
      'http://localhost:3000'
    );

    const deniedRes = await request(app)
      .get('/api/v1/health')
      .set('Origin', 'https://unauthorized-origin.example.com');

    expect(deniedRes.status).toBe(403);
    expect(deniedRes.body).toEqual({
      success: false,
      error: {
        code: 'CORS_ORIGIN_DENIED',
        message: 'Origin is not allowed by CORS policy',
      },
    });
  });
});
