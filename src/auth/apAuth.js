'use strict';

const axios = require('axios');
const { config } = require('../config');

/**
 * In-memory token cache for the Alternative Payments API.
 */
const tokenCache = {
  accessToken: null,
  expiresAt: 0,
};

/**
 * Exchange AP credentials for an OAuth bearer access token.
 *
 * Per AP docs:
 *   Authorization: Basic base64(clientId:clientSecret)
 *   Content-Type:  application/x-www-form-urlencoded
 *   Body:          grant_type=client_credentials   ← only this, nothing else
 *
 * @returns {Promise<string>} A valid bearer access token.
 */
async function getAPToken() {
  const now = Date.now();

  if (tokenCache.accessToken && now < tokenCache.expiresAt) {
    return tokenCache.accessToken;
  }

  const clientId     = config.ap.apiKey;               // as shown in AP dashboard
  const clientSecret = config.ap.clientSecret || '';   // empty when not issued
  const credential   = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  let response;
  try {
    response = await axios.post(
      config.ap.tokenUrl,
      'grant_type=client_credentials',               // body: only this field
      {
        headers: {
          Authorization: `Basic ${credential}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      },
    );
  } catch (err) {
    const detail = err.response?.data ?? err.message;
    throw new Error(
      `Alternative Payments token exchange failed: ${JSON.stringify(detail)}`,
    );
  }

  const { access_token, expires_in } = response.data;

  if (!access_token) {
    throw new Error('Alternative Payments token response did not include access_token.');
  }

  tokenCache.accessToken = access_token;
  tokenCache.expiresAt   = now + ((expires_in ?? 3600) - 60) * 1000;

  return access_token;
}

/**
 * Return a pre-configured axios instance authenticated for the AP API.
 *
 * @returns {Promise<import('axios').AxiosInstance>}
 */
async function getAPClient() {
  const token = await getAPToken();

  return axios.create({
    baseURL: config.ap.apiBaseUrl,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });
}

/** Invalidate the cached token (call on 401). */
function invalidateAPToken() {
  tokenCache.accessToken = null;
  tokenCache.expiresAt   = 0;
}

module.exports = { getAPToken, getAPClient, invalidateAPToken };
