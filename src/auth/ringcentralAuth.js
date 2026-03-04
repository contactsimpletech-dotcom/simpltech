'use strict';

const axios = require('axios');
const { config } = require('../config');

/**
 * In-memory token cache for the RingCentral API.
 * RingCentral access tokens are valid for 1 hour by default.
 * A 60-second buffer is applied to avoid sending a token about to expire.
 */
const tokenCache = {
  accessToken: null,
  expiresAt: 0,
};

/**
 * Exchange RingCentral JWT credentials for an OAuth bearer access token.
 *
 * Uses the JWT Bearer grant type (server-to-server, no user interaction):
 *   POST /restapi/oauth/token
 *   Authorization: Basic base64(clientId:clientSecret)
 *   Body: grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=<jwt>
 *
 * Generate a JWT in the RingCentral Developer Console:
 *   My Apps → <Your App> → Credentials → Create JWT
 *
 * @returns {Promise<string>} A valid bearer access token.
 */
async function getRCToken() {
  const now = Date.now();

  if (tokenCache.accessToken && now < tokenCache.expiresAt) {
    return tokenCache.accessToken;
  }

  const { clientId, clientSecret, jwtToken, serverUrl } = config.ringcentral;

  if (!clientId || !clientSecret || !jwtToken) {
    throw new Error(
      'RC_CLIENT_ID, RC_CLIENT_SECRET, and RC_JWT_TOKEN must all be set to use RingCentral.',
    );
  }

  const credential = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  let response;
  try {
    response = await axios.post(
      `${serverUrl}/restapi/oauth/token`,
      new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion:  jwtToken,
      }).toString(),
      {
        headers: {
          Authorization:  `Basic ${credential}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept:         'application/json',
        },
      },
    );
  } catch (err) {
    const detail = err.response?.data ?? err.message;
    throw new Error(`RingCentral token exchange failed: ${JSON.stringify(detail)}`);
  }

  const { access_token, expires_in } = response.data;

  if (!access_token) {
    throw new Error('RingCentral token response did not include access_token.');
  }

  tokenCache.accessToken = access_token;
  tokenCache.expiresAt   = now + ((expires_in ?? 3600) - 60) * 1000;

  return access_token;
}

/**
 * Return a pre-configured axios instance authenticated for the RingCentral REST API.
 *
 * Base URL is set to the configured server URL so callers can use relative paths
 * such as `/restapi/v1.0/account/~/extension/~/sms`.
 *
 * @returns {Promise<import('axios').AxiosInstance>}
 */
async function getRCClient() {
  const token = await getRCToken();

  return axios.create({
    baseURL: config.ringcentral.serverUrl,
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept:         'application/json',
    },
  });
}

/** Invalidate the cached token (call on 401). */
function invalidateRCToken() {
  tokenCache.accessToken = null;
  tokenCache.expiresAt   = 0;
}

module.exports = { getRCToken, getRCClient, invalidateRCToken };
