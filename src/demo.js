#!/usr/bin/env node
'use strict';

/**
 * demo.js — End-to-end walkthrough of the GoHighLevel Alternative Payments
 * integration using a Private Integration Token (PIT).
 *
 * Steps:
 *   1. Confirm the PIT API key is loaded.
 *   2. Create a GHL contact (client) using the form field names:
 *        first_name, last_name, email, phone
 *   3. Create a payment request for that client with the preset amount.
 *
 * Usage:
 *   cp .env.example .env        # fill in GHL_API_KEY (and optionally GHL_LOCATION_ID)
 *   npm install
 *   node src/demo.js
 *
 * Override the preset amount for a single run:
 *   PRESET_AMOUNT=2500 node src/demo.js   # $25.00
 */

require('dotenv').config();
const { validateConfig, config, authMode } = require('./config');
const { getAccessToken } = require('./auth/ghlAuth');
const { createClientWithPresetPayment } = require('./services/alternativePayments');

// ── Sample client — mirrors the form builder fields ──────────────────────────
const DEMO_CLIENT = {
  first_name: 'Jane',
  last_name: 'Demo',
  email: 'jane.demo@example.com',
  phone: '+15550001234',
  description: 'Onboarding fee — demo run',
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

  const mode            = authMode();
  const presetFormatted = formatCents(config.payment.presetAmount, config.payment.currency);

  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║  SimplTech — GoHighLevel Alternative Payments Demo  ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');
  console.log(`Auth mode     : ${mode === 'pit' ? 'Private Integration Token (PIT)' : 'OAuth client_credentials'}`);
  console.log(`Preset amount : ${presetFormatted}`);
  console.log(`API base URL  : ${config.ghl.apiBaseUrl}\n`);

  // ── Step 1: Confirm API key ────────────────────────────────────────────────
  console.log('Step 1 — Verifying API key…');
  let token;
  try {
    token = await getAccessToken();
    console.log(`  ✓ Key resolved: ${token.slice(0, 8)}…${token.slice(-4)}\n`);
  } catch (err) {
    console.error('  ✗ Failed:', err.message);
    process.exit(1);
  }

  // ── Step 2 & 3: Create client + payment request ───────────────────────────
  const fullName = `${DEMO_CLIENT.first_name} ${DEMO_CLIENT.last_name}`;
  console.log(`Step 2 — Creating GHL contact "${fullName}" (${DEMO_CLIENT.email})…`);
  console.log(`Step 3 — Attaching payment request for ${presetFormatted}…`);

  let result;
  try {
    result = await createClientWithPresetPayment({
      firstName: DEMO_CLIENT.first_name,
      lastName: DEMO_CLIENT.last_name,
      email: DEMO_CLIENT.email,
      phone: DEMO_CLIENT.phone,
      description: DEMO_CLIENT.description,
      redirectUrl: DEMO_CLIENT.redirectUrl,
    });
  } catch (err) {
    console.error('  ✗ Failed:', err.message);
    process.exit(1);
  }

  const { customer, paymentRequest } = result;
  const checkoutUrl =
    paymentRequest.url ?? paymentRequest.checkoutUrl ?? '(see paymentRequest object)';

  console.log('\n  ✓ GHL contact created:');
  console.log(`      ID        : ${customer.id}`);
  console.log(`      Name      : ${customer.firstName ?? ''} ${customer.lastName ?? ''}`);
  console.log(`      Email     : ${customer.email}`);

  console.log('\n  ✓ Payment request created:');
  console.log(`      ID        : ${paymentRequest.id}`);
  console.log(`      Amount    : ${formatCents(paymentRequest.amount ?? config.payment.presetAmount, paymentRequest.currency ?? config.payment.currency)}`);
  console.log(`      Status    : ${paymentRequest.status ?? 'pending'}`);
  console.log(`      Checkout  : ${checkoutUrl}`);

  console.log('\n  → Share the checkout URL with the client to collect payment.\n');
}

function formatCents(cents, currency) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

run();
