const express = require('express');
const request = require('supertest');
const { z } = require('zod');
const validate = require('../src/middleware/validate.middleware');
const { errorHandler } = require('../src/middleware/error.middleware');
const { sendSuccess } = require('../src/utils/ApiResponse');
const HTTP_STATUS = require('../src/constants/httpStatus');

describe('Zod Validation Middleware (Test 9)', () => {
  const testApp = express();
  testApp.use(express.json());

  const sampleSchema = {
    body: z.object({
      name: z.string().min(2),
      age: z.number().int().positive(),
    }),
  };

  testApp.post('/test-validate', validate(sampleSchema), (req, res) => {
    return sendSuccess(res, HTTP_STATUS.OK, req.body);
  });

  testApp.use(errorHandler);

  test('9a. Rejects invalid input with HTTP 400 and VALIDATION_ERROR details', async () => {
    const res = await request(testApp)
      .post('/test-validate')
      .send({ name: 'A', age: -5 });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toBe('Request validation failed');
    expect(Array.isArray(res.body.error.details)).toBe(true);
    expect(res.body.error.details.length).toBeGreaterThanOrEqual(2);
  });

  test('9b. Passes valid input through to route handler', async () => {
    const res = await request(testApp)
      .post('/test-validate')
      .send({ name: 'Jane Doe', age: 30 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: { name: 'Jane Doe', age: 30 },
    });
  });
});
