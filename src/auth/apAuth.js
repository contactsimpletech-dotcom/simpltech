'use strict';

const axios = require('axios');
const { config } = require('../config');

/**
 * In-memory token cache for the Alternative Payments API.
 */
const tokenCache = {
  accessToken: null,
  expiresAt:   0,
};

// Concurrency lock: any caller that arrives while a token fetch is in-flight
// waits on the same promise instead of firing a second credential exchange.
let _inflightTokenFetch = null;

/**
 * Exchange AP credentials for an OAuth bearer access token.
 * Token is cached until 60 seconds before its stated expiry.
 *
 * @returns {Promise<string>} A valid bearer access token.
 */
async function getAPToken() {
  const now = Date.now();

  if (tokenCache.accessToken && now < tokenCache.expiresAt) {
    return tokenCache.accessToken;
  }

  // Return the in-flight fetch if one is already running (prevents stampede).
  if (_inflightTokenFetch) return _inflightTokenFetch;

  _inflightTokenFetch = _fetchNewToken().finally(() => {
    _inflightTokenFetch = null;
  });

  return _inflightTokenFetch;
}

async function _fetchNewToken() {
  const rawKey = config.ap.apiKey;

  if (!rawKey) {
    throw new Error(
      'AP_API_KEY is not set. Add it in Render → Environment variables.',
    );
  }

  const clientId     = rawKey.trim();
  const clientSecret = config.ap.clientSecret || '';

  const credential = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const bodyParams = new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId });
  if (clientSecret) bodyParams.set('client_secret', clientSecret);

  let response;
  try {
    response = await axios.post(
      config.ap.tokenUrl,
      bodyParams.toString(),
      {
        headers: {
          Authorization: `Basic ${credential}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 10_000, // 10-second upstream timeout
      },
    );
  } catch (err) {
    const status = err.response?.status;
    // Log the failure without leaking the raw credential.
    console.error('[apAuth] token exchange failed');
    console.error('[apAuth] token URL:', config.ap.tokenUrl);
    if (err.response) {
      console.error('[apAuth] upstream status:', status);
      const denyReason = err.response.headers?.['x-deny-reason'];
      if (denyReason) console.error('[apAuth] deny reason:', denyReason);
    } else {
      console.error('[apAuth] network/other error:', err.message);
    }

    if (status === 403) {
      throw new Error(
        'Alternative Payments rejected the token request (403). ' +
        'Check AP_API_KEY and AP_CLIENT_SECRET in Render → Environment variables.',
      );
    }

    throw new Error(
      `Alternative Payments token exchange failed (HTTP ${status ?? 'N/A'}).`,
    );
  }

  const { access_token, expires_in } = response.data;

  if (!access_token) {
    throw new Error('Alternative Payments token response did not include access_token.');
  }

  tokenCache.accessToken = access_token;
  tokenCache.expiresAt   = Date.now() + ((expires_in ?? 3600) - 60) * 1000;

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
      Accept:         'application/json',
    },
    timeout: 30_000, // 30-second upstream timeout
  });
}

/** Invalidate the cached token (call on 401). */
function invalidateAPToken() {
  tokenCache.accessToken = null;
  tokenCache.expiresAt   = 0;
}

module.exports = { getAPToken, getAPClient, invalidateAPToken };
