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
 * Exchange the AP API key for a bearer access token using OAuth 2.0
 * client_credentials.
 *
 * The API key is the client_id. There is no client_secret — Basic Auth
 * is built as base64(clientId:) with an empty password.
 *
 * @returns {Promise<string>} A valid bearer access token.
 */
async function getAPToken() {
  const now = Date.now();

  if (tokenCache.accessToken && now < tokenCache.expiresAt) {
    return tokenCache.accessToken;
  }

  // Decode the base64 key from the dashboard to get the raw UUID client_id.
  const clientId   = Buffer.from(config.ap.apiKey, 'base64').toString('utf8');
  // No client_secret — Basic Auth uses empty password: base64(clientId:)
  const credential = Buffer.from(`${clientId}:`).toString('base64');

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
  }).toString();

  let response;
  try {
    response = await axios.post(
      config.ap.tokenUrl,
      body,
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
