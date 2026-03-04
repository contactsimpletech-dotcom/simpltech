'use strict';

const axios = require('axios');
const { config } = require('../config');

/**
 * In-memory token cache for the RingCentral API.
 * A 60-second buffer is applied to the stated expiry to avoid sending a token
 * that is about to expire on the wire.
 */
const tokenCache = {
  accessToken: null,
  expiresAt: 0,
};

/**
 * Exchange RingCentral credentials for an OAuth bearer access token.
 *
 * Uses the JWT Bearer grant (urn:ietf:params:oauth:grant-type:jwt-bearer),
 * which is the recommended server-to-server flow for RingCentral.
 *
 * Required env vars:
 *   RC_CLIENT_ID     — app client ID from developers.ringcentral.com
 *   RC_CLIENT_SECRET — app client secret
 *   RC_JWT           — JWT private key generated in the developer console
 *
 * @returns {Promise<string>} A valid bearer access token.
 */
async function getRCToken() {
  const now = Date.now();

  if (tokenCache.accessToken && now < tokenCache.expiresAt) {
    return tokenCache.accessToken;
  }

  const { clientId, clientSecret, jwt, apiBaseUrl } = config.ringCentral;

  if (!clientId || !clientSecret || !jwt) {
    throw new Error(
      'RC_CLIENT_ID, RC_CLIENT_SECRET, and RC_JWT are required. ' +
      'Generate a JWT in the RingCentral developer console.',
    );
  }

  const credential = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const tokenUrl   = `${apiBaseUrl}/restapi/oauth/token`;

  let response;
  try {
    response = await axios.post(
      tokenUrl,
      new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion:  jwt,
      }).toString(),
      {
        headers: {
          Authorization:  `Basic ${credential}`,
          'Content-Type': 'application/x-www-form-urlencoded',
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
 * Base URL is set to the versioned REST API root so service calls use
 * relative paths like `/account/~/extension/~/sms`.
 *
 * @returns {Promise<import('axios').AxiosInstance>}
 */
async function getRCClient() {
  const token = await getRCToken();

  return axios.create({
    baseURL: `${config.ringCentral.apiBaseUrl}/restapi/v1.0`,
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept:         'application/json',
    },
  });
}

/**
 * Force-clear the cached token.
 * Call this when a 401 is received so the next call fetches a fresh token.
 */
function invalidateRCToken() {
  tokenCache.accessToken = null;
  tokenCache.expiresAt   = 0;
}

module.exports = { getRCToken, getRCClient, invalidateRCToken };
