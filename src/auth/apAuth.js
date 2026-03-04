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
 *   Body:          grant_type, client_id, client_secret (RFC 6749 §2.3.1)
 *
 * @returns {Promise<string>} A valid bearer access token.
 */
async function getAPToken() {
  const now = Date.now();

  if (tokenCache.accessToken && now < tokenCache.expiresAt) {
    return tokenCache.accessToken;
  }

  const rawKey = config.ap.apiKey;

  if (!rawKey) {
    throw new Error(
      'AP_API_KEY is not set. Add it in Render → Environment variables.',
    );
  }

  // AP dashboard provides the API key as a base64-encoded UUID.
  // Decode it to get the actual client_id the OAuth server expects.
  const clientId     = Buffer.from(rawKey, 'base64').toString('utf8');
  // AP uses the client_id as the secret when none is issued separately.
  const clientSecret = config.ap.clientSecret || clientId;

  const credential = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  // Send credentials both in the Authorization header (Basic) and in the
  // request body (RFC 6749 §2.3.1) — AP requires both.
  const body = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     clientId,
    client_secret: clientSecret,
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
    console.error('[apAuth] token exchange failed');
    console.error('[apAuth] token URL:', config.ap.tokenUrl);
    console.error('[apAuth] client_id (decoded):', clientId);
    if (err.response) {
      console.error('[apAuth] upstream status:', err.response.status);
      console.error('[apAuth] upstream body:', JSON.stringify(err.response.data));
    } else {
      console.error('[apAuth] network/other error:', err.message);
    }
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
