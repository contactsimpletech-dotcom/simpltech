'use strict';

require('dotenv').config();

/**
 * Centralised configuration.
 *
 * ─── GoHighLevel (CRM contacts) ───────────────────────────────────────────────
 * Two auth modes:
 *   1. PIT — set GHL_API_KEY to a `pit-…` token from
 *      Settings → Integrations → Private Integrations.
 *      Used directly as a Bearer token (no exchange needed).
 *   2. OAuth client_credentials — set GHL_CLIENT_ID + GHL_CLIENT_SECRET.
 *      GHL_API_KEY takes precedence when both are present.
 *
 * ─── Alternative Payments ─────────────────────────────────────────────────────
 * Separate system at https://public-api.alternativepayments.io
 * Auth: OAuth 2.0 client_credentials with Basic Auth header.
 *   AP_API_KEY     — API key from Partner Dashboard → Team Preferences → API Keys
 *   AP_CLIENT_SECRET — client secret (leave blank if none was issued)
 */
const config = {
  // ── GoHighLevel CRM ──────────────────────────────────────────────────────────
  ghl: {
    apiKey: process.env.GHL_API_KEY,          // PIT, used as Bearer directly
    clientId: process.env.GHL_CLIENT_ID,
    clientSecret: process.env.GHL_CLIENT_SECRET,
    tokenUrl: process.env.GHL_TOKEN_URL || 'https://services.leadconnectorhq.com/oauth/token',
    apiBaseUrl: process.env.GHL_API_BASE_URL || 'https://services.leadconnectorhq.com',
    locationId: process.env.GHL_LOCATION_ID,
  },

  // ── Alternative Payments ──────────────────────────────────────────────────────
  ap: {
    apiKey: process.env.AP_API_KEY,                    // client_id for Basic Auth
    clientSecret: process.env.AP_CLIENT_SECRET || '',  // client_secret (may be empty)
    tokenUrl:
      process.env.AP_TOKEN_URL ||
      'https://public-api.alternativepayments.io/oauth/token',
    apiBaseUrl:
      process.env.AP_BASE_URL ||
      'https://public-api.alternativepayments.io',
    environment:
      process.env.AP_ENVIRONMENT || 'production',      // 'production' | 'staging'
  },

  // ── QuickBooks Online ──────────────────────────────────────────────────────────
  qbo: {
    clientId:      process.env.QBO_CLIENT_ID,
    clientSecret:  process.env.QBO_CLIENT_SECRET,
    refreshToken:  process.env.QBO_REFRESH_TOKEN,   // set after OAuth setup
    realmId:       process.env.QBO_REALM_ID,         // set after OAuth setup
    environment:   process.env.QBO_ENVIRONMENT || 'production', // 'sandbox' | 'production'
    serviceItemId: process.env.QBO_SERVICE_ITEM_ID || '1',      // QBO item/product ID for the line
    redirectBase:  process.env.APP_URL || 'https://simpltech-payment.onrender.com',
  },

  server: {
    port: parseInt(process.env.PORT || '3000', 10),
  },

  payment: {
    presetAmount: parseInt(process.env.PRESET_AMOUNT || '7500', 10), // cents; default $75.00
    currency: process.env.PRESET_CURRENCY || 'USD',
    invoiceDescription: process.env.INVOICE_DESCRIPTION || 'Service fee',
  },
};

/** @returns {'pit' | 'oauth'} */
function ghlAuthMode() {
  return config.ghl.apiKey ? 'pit' : 'oauth';
}

/**
 * Returns true when all four QBO env vars are present.
 * (clientId + clientSecret are set during app registration;
 *  realmId + refreshToken are set after running /api/qbo/connect.)
 * @returns {boolean}
 */
function qboEnabled() {
  const q = config.qbo;
  return !!(q.clientId && q.clientSecret && q.realmId && q.refreshToken);
}

function validateConfig() {
  // QBO vars are set up post-deploy via /api/qbo/connect — warn but don't exit.
  const q = config.qbo;
  if (!q.clientId || !q.clientSecret) {
    console.warn('[config] QBO_CLIENT_ID / QBO_CLIENT_SECRET not set — QBO integration disabled.');
  } else if (!q.realmId || !q.refreshToken) {
    console.warn('[config] QBO_REALM_ID / QBO_REFRESH_TOKEN not set — visit /api/qbo/connect to authorise.');
  }
}

module.exports = { config, ghlAuthMode, qboEnabled, validateConfig };
