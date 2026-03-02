'use strict';

require('dotenv').config();

/**
 * Centralised configuration.
 * All values are read from environment variables so that credentials are never
 * hard-coded and the app can be deployed in multiple environments without code
 * changes.
 */
const config = {
  ghl: {
    clientId: process.env.GHL_CLIENT_ID,
    clientSecret: process.env.GHL_CLIENT_SECRET,
    tokenUrl: process.env.GHL_TOKEN_URL || 'https://services.leadconnectorhq.com/oauth/token',
    apiBaseUrl: process.env.GHL_API_BASE_URL || 'https://services.leadconnectorhq.com',
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
 * Validate that the required GHL credentials are present.
 * Called at startup so the server fails fast instead of producing confusing
 * 401 errors at runtime.
 */
function validateConfig() {
  const missing = [];
  if (!config.ghl.clientId) missing.push('GHL_CLIENT_ID');
  if (!config.ghl.clientSecret) missing.push('GHL_CLIENT_SECRET');

  if (missing.length) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}.\n` +
      'Copy .env.example to .env and fill in your GoHighLevel credentials.',
    );
  }
}

module.exports = { config, validateConfig };
