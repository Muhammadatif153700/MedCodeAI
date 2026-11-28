const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const { env } = require('./config/env');
const HTTP_STATUS = require('./constants/httpStatus');
const ApiError = require('./utils/ApiError');
const requestIdMiddleware = require('./middleware/requestId.middleware');
const { notFoundHandler, errorHandler } = require('./middleware/error.middleware');
const apiV1Router = require('./routes');
const { mountSwaggerDocs } = require('./config/swagger');

const app = express();

app.disable('x-powered-by');
app.use(requestIdMiddleware);
app.use(helmet());

const corsOptions = {
  origin(origin, callback) {
    if (!origin || env.CORS_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    return callback(
      new ApiError(
        HTTP_STATUS.FORBIDDEN,
        'CORS_ORIGIN_DENIED',
        'Origin is not allowed by CORS policy'
      )
    );
  },
  credentials: true,
};

app.use(cors(corsOptions));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => env.NODE_ENV === 'test',
  handler: (_req, _res, next) => {
    next(
      new ApiError(
        HTTP_STATUS.TOO_MANY_REQUESTS,
        'RATE_LIMIT_EXCEEDED',
        'Too many requests, please try again later'
      )
    );
  },
});

app.use('/api', apiLimiter);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

if (env.NODE_ENV !== 'test') {
  morgan.token('req-id', (req) => req.id || '-');
  morgan.token('path-only', (req) => (req.originalUrl || req.url || '').split('?')[0]);
  app.use(
    morgan(':req-id :method :path-only :status :res[content-length] - :response-time ms')
  );
}

app.use('/api/v1', apiV1Router);
mountSwaggerDocs(app, env.NODE_ENV);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;