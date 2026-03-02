'use strict';

const axios = require('axios');
const { config } = require('../config');

const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';

const tokenCache = {
  accessToken: null,
  expiresAt: 0,
};

/**
 * Exchange the stored QBO refresh token for a short-lived access token.
 * Tokens are cached in memory and auto-refreshed on expiry.
 *
 * If Intuit issues a new refresh token alongside the access token, it is
 * written back to config.qbo.refreshToken and logged to stdout so you can
 * update QBO_REFRESH_TOKEN in Render before the old one expires.
 *
 * @returns {Promise<string>} Bearer access token.
 */
async function getQBOToken() {
  const now = Date.now();

  if (tokenCache.accessToken && now < tokenCache.expiresAt) {
    return tokenCache.accessToken;
  }

  const credential = Buffer.from(
    `${config.qbo.clientId}:${config.qbo.clientSecret}`,
  ).toString('base64');

  let response;
  try {
    response = await axios.post(
      TOKEN_URL,
      new URLSearchParams({
        grant_type:    'refresh_token',
        refresh_token: config.qbo.refreshToken,
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
    throw new Error(`QuickBooks token refresh failed: ${JSON.stringify(detail)}`);
  }

  const { access_token, expires_in, refresh_token } = response.data;

  if (!access_token) {
    throw new Error('QuickBooks token response did not include access_token.');
  }

  // Intuit rotates the refresh token periodically — capture and warn.
  if (refresh_token && refresh_token !== config.qbo.refreshToken) {
    config.qbo.refreshToken = refresh_token;
    console.warn(
      '[QBO] New refresh token issued — update QBO_REFRESH_TOKEN in Render:\n',
      refresh_token,
    );
  }

  tokenCache.accessToken = access_token;
  tokenCache.expiresAt   = now + (expires_in - 60) * 1000;

  return access_token;
}

/**
 * Return a pre-configured axios instance for the QBO Accounting API.
 * Base URL includes the company realm ID.
 *
 * @returns {Promise<import('axios').AxiosInstance>}
 */
async function getQBOClient() {
  const token   = await getQBOToken();
  const subdomain = config.qbo.environment === 'sandbox'
    ? 'sandbox-quickbooks'
    : 'quickbooks';

  return axios.create({
    baseURL: `https://${subdomain}.api.intuit.com/v3/company/${config.qbo.realmId}`,
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept:         'application/json',
    },
  });
}

module.exports = { getQBOToken, getQBOClient };
