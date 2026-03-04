'use strict';

const path    = require('path');
const express = require('express');
const { config, validateConfig } = require('./config');

validateConfig();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // handles HTML form POST submissions
app.use(express.static(path.join(__dirname, '..', 'public')));

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/keys',      require('./routes/keys'));
app.use('/api/clients',   require('./routes/clients'));
app.use('/api/agreement', require('./routes/agreement'));
app.use('/api/webhooks',    require('./routes/webhooks'));
app.use('/api/ringcentral', require('./routes/ringcentral'));
app.use('/api/qbo',         require('./routes/qbo'));

app.get('/health', (_req, res) =>
  res.json({ ok: true, service: 'simpltech-ghl-payments' }),
);

app.use((_req, res) => res.status(404).json({ ok: false, error: 'Not found' }));

// ─── Start ────────────────────────────────────────────────────────────────────
const { port } = config.server;
app.listen(port, () => {
  const fmt = (c, cur) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(c / 100);

  console.log(`\nsimpltech Payment server → http://localhost:${port}`);
  console.log(`  Preset amount : ${fmt(config.payment.presetAmount, config.payment.currency)}`);
  console.log(`  QBO env       : ${config.qbo.environment}\n`);
});
