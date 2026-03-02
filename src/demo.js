#!/usr/bin/env node
'use strict';

/**
 * demo.js — End-to-end demonstration of the GoHighLevel Alternative Payments integration.
 *
 * Runs three steps in sequence:
 *   1. Exchange the configured API key for a GHL bearer token.
 *   2. Create a customer (client) in Alternative Payments.
 *   3. Create a payment request against that customer with the preset amount.
 *
 * Usage:
 *   cp .env.example .env        # fill in GHL_CLIENT_ID and GHL_CLIENT_SECRET
 *   npm install
 *   node src/demo.js
 *
 * To override the preset amount for this demo run:
 *   PRESET_AMOUNT=2500 node src/demo.js   # $25.00
 */

require('dotenv').config();
const { validateConfig, config } = require('./config');
const { getAccessToken } = require('./auth/ghlAuth');
const { createClientWithPresetPayment } = require('./services/alternativePayments');

const DEMO_CUSTOMER = {
  name: 'Jane Demo',
  email: 'jane.demo@example.com',
  phone: '+15550001234',
  description: 'Onboarding payment — demo run',
  redirectUrl: 'https://yourdomain.com/payment-complete',
};

async function run() {
  // ── Step 0: Validate config ────────────────────────────────────────────────
  try {
    validateConfig();
  } catch (err) {
    console.error('\n[ERROR] Configuration problem:\n', err.message);
    process.exit(1);
  }

  const presetFormatted = formatCents(config.payment.presetAmount, config.payment.currency);
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║  SimplTech — GoHighLevel Alternative Payments Demo  ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');
  console.log(`Preset amount : ${presetFormatted}`);
  console.log(`Token URL     : ${config.ghl.tokenUrl}`);
  console.log(`API base URL  : ${config.ghl.apiBaseUrl}\n`);

  // ── Step 1: API key → bearer token ────────────────────────────────────────
  console.log('Step 1 — Exchanging API key for bearer token…');
  let token;
  try {
    token = await getAccessToken();
    console.log(`  ✓ Token obtained: ${token.slice(0, 6)}…${token.slice(-6)}\n`);
  } catch (err) {
    console.error('  ✗ Token exchange failed:', err.message);
    process.exit(1);
  }

  // ── Step 2 & 3: Create customer + payment request ─────────────────────────
  console.log(`Step 2 — Creating client "${DEMO_CUSTOMER.name}" (${DEMO_CUSTOMER.email})…`);
  console.log(`Step 3 — Attaching payment request for ${presetFormatted}…`);

  let result;
  try {
    result = await createClientWithPresetPayment(DEMO_CUSTOMER);
  } catch (err) {
    console.error('  ✗ Failed:', err.message);
    process.exit(1);
  }

  const { customer, paymentRequest } = result;
  const checkoutUrl = paymentRequest.url ?? paymentRequest.checkoutUrl ?? '(see paymentRequest object)';

  console.log('\n  ✓ Customer created:');
  console.log(`      ID    : ${customer.id}`);
  console.log(`      Name  : ${customer.name}`);
  console.log(`      Email : ${customer.email}`);

  console.log('\n  ✓ Payment request created:');
  console.log(`      ID      : ${paymentRequest.id}`);
  console.log(`      Amount  : ${formatCents(paymentRequest.amount ?? config.payment.presetAmount, paymentRequest.currency ?? config.payment.currency)}`);
  console.log(`      Status  : ${paymentRequest.status ?? 'pending'}`);
  console.log(`      Checkout: ${checkoutUrl}`);

  console.log('\n  → Share the checkout URL with the client to collect payment.\n');
}

function formatCents(cents, currency) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

run();
