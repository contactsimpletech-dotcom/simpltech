'use strict';

const axios = require('axios');
const { config } = require('../config');

/**
 * In-memory token cache.
 * Stores the current access token and the timestamp at which it expires.
 * A 60-second buffer is subtracted from the expiry to avoid using a token
 * that is about to expire on the wire.
 */
const tokenCache = {
  accessToken: null,
  expiresAt: 0, // Unix timestamp (ms)
};

/**
 * Exchange the stored client_id / client_secret for a bearer access token
 * using the OAuth 2.0 client_credentials grant.
 *
 * The result is cached in memory; subsequent calls within the token's lifetime
 * return the cached value without hitting the token endpoint again.
 *
 * @returns {Promise<string>} A valid bearer access token.
 */
async function getAccessToken() {
  const now = Date.now();

  // Return cached token if it is still valid.
  if (tokenCache.accessToken && now < tokenCache.expiresAt) {
    return tokenCache.accessToken;
  }

  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.ghl.clientId,
    client_secret: config.ghl.clientSecret,
  });

  let response;
  try {
    response = await axios.post(config.ghl.tokenUrl, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  } catch (err) {
    const detail = err.response?.data ?? err.message;
    throw new Error(`GoHighLevel token exchange failed: ${JSON.stringify(detail)}`);
  }

  const { access_token, expires_in } = response.data;

  if (!access_token) {
    throw new Error('GoHighLevel token response did not include access_token.');
  }

  // Cache with a 60-second buffer before the stated expiry.
  tokenCache.accessToken = access_token;
  tokenCache.expiresAt = now + (expires_in - 60) * 1000;

  return access_token;
}

/**
 * Return a pre-configured axios instance that automatically injects the
 * GoHighLevel bearer token into every request.
 *
 * Usage:
 *   const client = await getAuthenticatedClient();
 *   const res = await client.get('/alternative-payments/customers');
 */
async function getAuthenticatedClient() {
  const token = await getAccessToken();

  return axios.create({
    baseURL: config.ghl.apiBaseUrl,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Version: '2021-07-28', // GHL API version header
    },
  });
}

/**
 * Force-clear the cached token.
 * Useful in tests or when a 401 response is received on a real request,
 * indicating the token was revoked externally.
 */
function invalidateToken() {
  tokenCache.accessToken = null;
  tokenCache.expiresAt = 0;
}

module.exports = { getAccessToken, getAuthenticatedClient, invalidateToken };
