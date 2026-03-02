'use strict';

const express = require('express');
const { config, validateConfig } = require('./config');

// Fail fast if required GHL credentials are missing.
validateConfig();

const app = express();
app.use(express.json());

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/keys', require('./routes/keys'));
app.use('/api/clients', require('./routes/clients'));

// Health check
app.get('/health', (_req, res) => res.json({ ok: true, service: 'simpltech-ghl-payments' }));

// 404 catch-all
app.use((_req, res) => res.status(404).json({ ok: false, error: 'Not found' }));

// ─── Start ────────────────────────────────────────────────────────────────────
const { port } = config.server;
app.listen(port, () => {
  console.log(`simpltech GHL Payments server running on http://localhost:${port}`);
  console.log(`  Preset payment amount : ${formatCents(config.payment.presetAmount, config.payment.currency)}`);
  console.log(`  GHL API base          : ${config.ghl.apiBaseUrl}`);
});

function formatCents(cents, currency) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}
