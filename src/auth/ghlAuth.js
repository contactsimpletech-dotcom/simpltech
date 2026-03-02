'use strict';

const axios = require('axios');
const { config, ghlAuthMode } = require('../config');

/**
 * In-memory cache for OAuth tokens (not used in PIT mode).
 * A 60-second buffer is applied to the stated expiry to avoid sending a token
 * that is about to expire on the wire.
 */
const tokenCache = {
  accessToken: null,
  expiresAt: 0,
};

/**
 * Resolve the current bearer token.
 *
 * - PIT mode  : returns the `pit-…` key directly (no network call).
 * - OAuth mode: exchanges client_id/secret for a short-lived token and caches
 *               the result until it expires.
 *
 * @returns {Promise<string>} A valid bearer token string.
 */
async function getAccessToken() {
  // ── PIT mode ──────────────────────────────────────────────────────────────
  if (ghlAuthMode() === 'pit') {
    return config.ghl.apiKey;
  }

  // ── OAuth client_credentials mode ─────────────────────────────────────────
  const now = Date.now();
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

  tokenCache.accessToken = access_token;
  tokenCache.expiresAt = now + (expires_in - 60) * 1000;

  return access_token;
}

/**
 * Return a pre-configured axios instance with the bearer token already set.
 *
 * @returns {Promise<import('axios').AxiosInstance>}
 */
async function getAuthenticatedClient() {
  const token = await getAccessToken();

  return axios.create({
    baseURL: config.ghl.apiBaseUrl,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Version: '2021-07-28', // required by GHL API v2
    },
  });
}

/**
 * Force-clear the cached OAuth token.
 * Call this when a 401 is received on a real request so the next
 * call re-fetches a fresh token.  No-op in PIT mode.
 */
function invalidateToken() {
  tokenCache.accessToken = null;
  tokenCache.expiresAt = 0;
}

module.exports = { getAccessToken, getAuthenticatedClient, invalidateToken, ghlAuthMode };
