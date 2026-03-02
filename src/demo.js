#!/usr/bin/env node
'use strict';

/**
 * demo.js — End-to-end walkthrough:
 *
 *   Step 1 — Verify GHL key (PIT) is present
 *   Step 2 — Exchange AP API key for an access token (OAuth 2.0 Basic Auth)
 *   Step 3 — Create a customer in Alternative Payments
 *   Step 4 — Create a payment request at the preset amount
 *
 * Usage:
 *   cp .env.example .env   # fill in GHL_API_KEY and AP_API_KEY
 *   npm install
 *   node src/demo.js
 *
 * Use the demo environment:
 *   AP_BASE_URL=https://public-api.demo.alternativepayments.io node src/demo.js
 *
 * Override the preset amount:
 *   PRESET_AMOUNT=2500 node src/demo.js   # $25.00
 */

require('dotenv').config();
const { validateConfig, config } = require('./config');
const { getAPToken }              = require('./auth/apAuth');
const { createClientWithPresetPayment } = require('./services/alternativePayments');

// ── Sample client (mirrors GHL form builder query keys) ──────────────────────
const CLIENT = {
  first_name: 'Jane',
  last_name:  'Demo',
  email:      'jane.demo@example.com',
  redirect_url: 'https://yourdomain.com/payment-complete',
};

async function run() {
  try { validateConfig(); }
  catch (err) { console.error('\n[ERROR]', err.message); process.exit(1); }

  const fmt = (c, cur) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(c / 100);

  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║  SimplTech — GoHighLevel + Alternative Payments Demo ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');
  console.log(`AP base URL    : ${config.ap.apiBaseUrl}`);
  console.log(`Preset amount  : ${fmt(config.payment.presetAmount, config.payment.currency)}\n`);

  // ── Step 1: GHL key ────────────────────────────────────────────────────────
  console.log('Step 1 — GHL key check…');
  const ghlKey = config.ghl.apiKey;
  if (!ghlKey) { console.error('  ✗ GHL_API_KEY not set'); process.exit(1); }
  console.log(`  ✓ GHL PIT key : ${ghlKey.slice(0, 8)}…${ghlKey.slice(-4)}\n`);

  // ── Step 2: AP OAuth token ─────────────────────────────────────────────────
  console.log('Step 2 — Exchanging AP API key for access token…');
  let apToken;
  try {
    apToken = await getAPToken();
    console.log(`  ✓ AP token    : ${apToken.slice(0, 8)}…${apToken.slice(-4)}\n`);
  } catch (err) {
    console.error('  ✗ AP token exchange failed:', err.message);
    process.exit(1);
  }

  // ── Steps 3 & 4: Create customer + payment request ────────────────────────
  console.log(`Step 3 — Creating AP customer "${CLIENT.first_name} ${CLIENT.last_name}"…`);
  console.log(`Step 4 — Attaching payment request for ${fmt(config.payment.presetAmount, config.payment.currency)}…`);

  let result;
  try {
    result = await createClientWithPresetPayment(CLIENT);
  } catch (err) {
    console.error('  ✗ Failed:', err.message);
    process.exit(1);
  }

  const { customer, paymentRequest, checkoutUrl } = result;

  console.log('\n  ✓ Customer created:');
  console.log(`      ID       : ${customer.id}`);
  console.log(`      Name     : ${customer.name}`);
  console.log(`      Email    : ${customer.email}`);

  console.log('\n  ✓ Payment request created:');
  console.log(`      ID       : ${paymentRequest.id}`);
  console.log(`      Status   : ${paymentRequest.status}`);
  console.log(`      Checkout : ${checkoutUrl ?? '(see paymentRequest object)'}`);

  console.log('\n  → Share the checkout URL with the client to collect payment.\n');
}

run();
