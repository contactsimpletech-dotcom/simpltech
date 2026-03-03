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
  return axios.create({
    baseURL: config.ap.apiBaseUrl,
    headers: {
      Authorization: `Bearer ${config.ap.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });
}

/**
 * Returns the AP API key for use as a Bearer token.
 * Kept for compatibility with routes/keys.js verification endpoint.
 */
async function getAPToken() {
  if (!config.ap.apiKey) {
    throw new Error('AP_API_KEY is not set.');
  }
  return config.ap.apiKey;
}

/** No-op — static API keys don't need invalidation. */
function invalidateAPToken() {}

module.exports = { getAPToken, getAPClient, invalidateAPToken };
