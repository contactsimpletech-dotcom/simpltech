'use strict';

require('dotenv').config();

/**
 * Centralised configuration.
 *
 * GoHighLevel supports two authentication modes:
 *
 *   1. Private Integration Token (PIT)  ← recommended for simple integrations
 *      Set GHL_API_KEY to a `pit-…` token obtained from
 *      Settings → Integrations → Private Integrations in your GHL sub-account.
 *      The token is used directly as a Bearer header — no OAuth exchange needed.
 *
 *   2. OAuth 2.0 client_credentials (app-level / agency installs)
 *      Set GHL_CLIENT_ID + GHL_CLIENT_SECRET from the Marketplace app settings.
 *      The auth service will exchange them for a short-lived access token.
 *
 * GHL_API_KEY takes precedence when both are provided.
 */
const config = {
  ghl: {
    // PIT — used directly as a bearer token when present.
    apiKey: process.env.GHL_API_KEY,

    // OAuth client-credentials (fallback when no PIT is set).
    clientId: process.env.GHL_CLIENT_ID,
    clientSecret: process.env.GHL_CLIENT_SECRET,
    tokenUrl: process.env.GHL_TOKEN_URL || 'https://services.leadconnectorhq.com/oauth/token',

    apiBaseUrl: process.env.GHL_API_BASE_URL || 'https://services.leadconnectorhq.com',

    // Required when creating contacts via the GHL Contacts API.
    locationId: process.env.GHL_LOCATION_ID,
  },
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
  },
  payment: {
    presetAmount: parseInt(process.env.PRESET_AMOUNT || '5000', 10), // cents
    currency: process.env.PRESET_CURRENCY || 'USD',
  },
};

/**
 * Detect which auth mode is active.
 * @returns {'pit' | 'oauth'}
 */
function authMode() {
  return config.ghl.apiKey ? 'pit' : 'oauth';
}

/**
 * Validate that required credentials are present for whichever auth mode is
 * configured.  Called at startup so the server fails fast.
 */
function validateConfig() {
  const missing = [];

  if (config.ghl.apiKey) {
    // PIT mode — nothing else required for auth.
  } else {
    if (!config.ghl.clientId) missing.push('GHL_CLIENT_ID');
    if (!config.ghl.clientSecret) missing.push('GHL_CLIENT_SECRET');
  }

  if (missing.length) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}.\n` +
      'Set GHL_API_KEY (Private Integration Token) OR both GHL_CLIENT_ID and\n' +
      'GHL_CLIENT_SECRET. Copy .env.example to .env to get started.',
    );
  }
}

module.exports = { config, authMode, validateConfig };
