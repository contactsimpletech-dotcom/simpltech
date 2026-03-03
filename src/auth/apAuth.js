'use strict';

const axios = require('axios');
const { config } = require('../config');

/**
 * Return a pre-configured axios instance authenticated for the AP API.
 * The AP_API_KEY is used directly as a Bearer token.
 *
 * @returns {Promise<import('axios').AxiosInstance>}
 */
async function getAPClient() {
  // The dashboard shows the key as base64; decode to get the raw UUID token.
  const token = Buffer.from(config.ap.apiKey, 'base64').toString('utf8');
  return axios.create({
    baseURL: config.ap.apiBaseUrl,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });
}

/**
 * Returns the decoded AP API key for use as a Bearer token.
 * Kept for compatibility with routes/keys.js verification endpoint.
 */
async function getAPToken() {
  if (!config.ap.apiKey) {
    throw new Error('AP_API_KEY is not set.');
  }
  return Buffer.from(config.ap.apiKey, 'base64').toString('utf8');
}

/** No-op — static API keys don't need invalidation. */
function invalidateAPToken() {}

module.exports = { getAPToken, getAPClient, invalidateAPToken };
