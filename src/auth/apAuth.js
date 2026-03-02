'use strict';

const axios = require('axios');
const { config } = require('../config');

/**
 * In-memory token cache for the Alternative Payments API.
 * The AP OAuth flow does NOT issue refresh tokens — we simply re-exchange
 * when the access token expires.
 */
const tokenCache = {
  accessToken: null,
  expiresAt: 0, // Unix ms
};

/**
 * Exchange the AP API key for a bearer access token using OAuth 2.0
 * client_credentials with HTTP Basic Auth.
 *
 * Auth header format:
 *   Authorization: Basic BASE64(apiKey:clientSecret)
 *
 * The token is cached in memory; subsequent calls within the lifetime of the
 * token return the cached value without a network round-trip.
 *
 * @returns {Promise<string>} A valid bearer access token.
 */
async function getAPToken() {
  const now = Date.now();

  if (tokenCache.accessToken && now < tokenCache.expiresAt) {
    return tokenCache.accessToken;
  }

  // Build Basic Auth credential: base64(apiKey:clientSecret)
  const credential = Buffer.from(
    `${config.ap.apiKey}:${config.ap.clientSecret}`,
  ).toString('base64');

  // Send credentials both as Basic Auth header and as body params — AP's
  // OAuth server requires client_id in the body (RFC 6749 §2.3.1).
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.ap.apiKey,
    ...(config.ap.clientSecret && { client_secret: config.ap.clientSecret }),
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
    throw new Error(
      'Alternative Payments token response did not include access_token.',
    );
  }

  // Cache with a 60-second safety buffer.
  tokenCache.accessToken = access_token;
  tokenCache.expiresAt = now + (expires_in - 60) * 1000;

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
  tokenCache.expiresAt = 0;
}

module.exports = { getAPToken, getAPClient, invalidateAPToken };
