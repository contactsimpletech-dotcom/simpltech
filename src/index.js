'use strict';

const express = require('express');
const { config, validateConfig } = require('./config');

validateConfig();

const app = express();
app.use(express.json());

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/keys',     require('./routes/keys'));
app.use('/api/clients',  require('./routes/clients'));
app.use('/api/webhooks', require('./routes/webhooks'));

app.get('/health', (_req, res) =>
  res.json({ ok: true, service: 'simpltech-ghl-payments' }),
);

app.use((_req, res) => res.status(404).json({ ok: false, error: 'Not found' }));

// ─── Start ────────────────────────────────────────────────────────────────────
const { port } = config.server;
app.listen(port, () => {
  const fmt = (c, cur) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(c / 100);

  console.log(`\nsimpltech GHL + Alternative Payments server → http://localhost:${port}`);
  console.log(`  Preset amount : ${fmt(config.payment.presetAmount, config.payment.currency)}`);
  console.log(`  AP base URL   : ${config.ap.apiBaseUrl}`);
  console.log(`  GHL base URL  : ${config.ghl.apiBaseUrl}\n`);
});
