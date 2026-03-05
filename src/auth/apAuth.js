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
  // Use AP_CLIENT_SECRET if set; otherwise send empty secret (uuid:).
  // Do NOT fall back to clientId — inventing a secret causes 403.
  const clientSecret = config.ap.clientSecret || '';

  const credential = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  // Send grant_type + client_id in body. Omit client_secret when empty
  // (some servers reject a blank client_secret field).
  const bodyParams = new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId });
  if (clientSecret) bodyParams.set('client_secret', clientSecret);
  const body = bodyParams.toString();

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
    const status = err.response?.status;
    const detail = err.response?.data ?? err.message;
    console.error('[apAuth] token exchange failed');
    console.error('[apAuth] token URL:', config.ap.tokenUrl);
    console.error('[apAuth] client_id (decoded):', clientId);
    if (err.response) {
      console.error('[apAuth] upstream status:', status);
      console.error('[apAuth] upstream body:', JSON.stringify(err.response.data));
      const denyReason = err.response.headers?.['x-deny-reason'];
      if (denyReason) console.error('[apAuth] deny reason:', denyReason);
    } else {
      console.error('[apAuth] network/other error:', err.message);
    }

    if (status === 403) {
      throw new Error(
        'Alternative Payments rejected the token request (403). ' +
        'Check that AP_API_KEY matches the active Client ID in AP Dashboard → Team Preferences → API Keys, ' +
        'and that AP_CLIENT_SECRET is the matching secret.',
      );
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
