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

function validateConfig() {
  const missing = [];

  // GHL auth
  if (!config.ghl.apiKey) {
    if (!config.ghl.clientId)     missing.push('GHL_CLIENT_ID');
    if (!config.ghl.clientSecret) missing.push('GHL_CLIENT_SECRET');
  }

  // Alternative Payments auth
  if (!config.ap.apiKey) missing.push('AP_API_KEY');

  if (missing.length) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}.\n` +
      'Copy .env.example to .env and fill in your credentials.',
    );
  }
}

module.exports = { config, ghlAuthMode, validateConfig };
