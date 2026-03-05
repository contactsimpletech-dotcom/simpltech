'use strict';

const path    = require('path');
const express = require('express');
const { config, validateConfig }           = require('./config');
const { corsMiddleware, helmetMiddleware }  = require('./middleware/security');
const { apiLimiter }                       = require('./middleware/rateLimit');

validateConfig();

const app = express();

// Trust the first proxy hop (Render's load balancer / Cloudflare).
// Required so express-rate-limit reads the real client IP from X-Forwarded-For
// instead of the proxy's IP, and so req.ip is accurate.
app.set('trust proxy', 1);

// ─── Security headers (helmet) ────────────────────────────────────────────────
app.use(helmetMiddleware);

// ─── CORS ────────────────────────────────────────────────────────────────────
app.use(corsMiddleware);

// ─── Body parsing ────────────────────────────────────────────────────────────
// 512 KB limit covers the signature_data base64 payload.
// Requests that exceed this receive a 413 before any route logic runs.
app.use(express.json({ limit: '512kb' }));
app.use(express.urlencoded({ extended: true, limit: '512kb' }));

// ─── Request logger (no PII) ──────────────────────────────────────────────────
// Log method + path only — do NOT log Content-Type or body fields that may
// contain email / phone / signature data.
app.use((req, _res, next) => {
  console.log('[req]', req.method, req.path);
  next();
});

// ─── Static files ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '..', 'public')));

// ─── API rate limiting ────────────────────────────────────────────────────────
// Applied to all /api/* routes. Tighter limiter on /api/agreement is mounted
// inside routes/agreement.js.
app.use('/api', apiLimiter);

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/keys',      require('./routes/keys'));
app.use('/api/clients',   require('./routes/clients'));
app.use('/api/agreement', require('./routes/agreement'));
app.use('/api/webhooks',  require('./routes/webhooks'));
app.use('/api/qbo',       require('./routes/qbo'));

app.get('/health', (_req, res) =>
  res.json({ ok: true, service: 'simpltech-ghl-payments' }),
);

app.use((_req, res) => res.status(404).json({ ok: false, error: 'Not found' }));

// ─── Global error handler ─────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[express error]', err?.message);
  console.error(err?.stack);
  // Never expose internal stack traces or raw error messages to clients.
  res.status(500).json({ ok: false, error: 'Internal server error' });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const { port } = config.server;
app.listen(port, () => {
  const fmt = (c, cur) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(c / 100);

  console.log(`\nsimpltech Payment server → http://localhost:${port}`);
  console.log(`  Preset amount : ${fmt(config.payment.presetAmount, config.payment.currency)}`);
  console.log(`  QBO env       : ${config.qbo.environment}\n`);
});

process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err?.message ?? err);
});

process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err?.message ?? err);
});
