'use strict';

const axios = require('axios');

const { config }     = require('../config');
const tokenStore     = require('../store/tokenStore');

const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';

const tokenCache = {
  accessToken: null,
  expiresAt:   0,
};

// ── Bootstrap: prefer store over env var ─────────────────────────────────────
// The store is written on every token rotation so it always holds the latest
// valid refresh token.  The env var is only useful the very first time (before
// any rotation has happened).
(function bootstrap() {
  const stored = tokenStore.get('qbo_refresh_token');
  if (stored) {
    config.qbo.refreshToken = stored;
    console.log('[QBO] Loaded refresh token from token store.');
  } else if (config.qbo.refreshToken) {
    // Seed the store with the env-var value so future rotations persist cleanly.
    tokenStore.save({
      qbo_refresh_token: config.qbo.refreshToken,
      qbo_realm_id:      config.qbo.realmId || '',
    });
    console.log('[QBO] Seeded token store from env var.');
  }

  // Also load realm ID from store if not present in env.
  const storedRealm = tokenStore.get('qbo_realm_id');
  if (storedRealm && !config.qbo.realmId) {
    config.qbo.realmId = storedRealm;
  }
}());

/**
 * Exchange the stored QBO refresh token for a short-lived access token.
 * Caches the access token in memory and auto-refreshes on expiry.
 *
 * Token rotation is handled automatically:
 *   1. New refresh token written to the persistent store (permanent).
 *   2. In-memory config updated so the running process stays valid.
 *   3. Render env var updated as a secondary backup (optional).
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

  // QBO always rotates the refresh token on each use — persist the new one.
  if (refresh_token && refresh_token !== config.qbo.refreshToken) {
    config.qbo.refreshToken = refresh_token;
    // DB write — this is now the primary persistence mechanism.
    tokenStore.save({ qbo_refresh_token: refresh_token });
    // Render env var update — secondary backup (no-op if keys not set).
    updateRenderEnvVar(refresh_token).catch(() => {});
    console.log('[QBO] Refresh token rotated and saved to store.');
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
  const token     = await getQBOToken();
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

// ── Optional: keep Render env var in sync as a backup ────────────────────────
// Set RENDER_API_KEY + RENDER_SERVICE_ID to enable.
// The store is the primary source of truth; this is purely a convenience so the
// env var shown in the Render dashboard stays current.
async function updateRenderEnvVar(newToken) {
  const apiKey    = process.env.RENDER_API_KEY;
  const serviceId = process.env.RENDER_SERVICE_ID;
  if (!apiKey || !serviceId) return;

  const headers = {
    Authorization:  `Bearer ${apiKey}`,
    Accept:         'application/json',
    'Content-Type': 'application/json',
  };

  try {
    const { data } = await axios.get(
      `https://api.render.com/v1/services/${serviceId}/env-vars`,
      { headers },
    );
    const vars = (Array.isArray(data) ? data : []).map(item => ({
      key:   item.envVar?.key   ?? item.key,
      value: (item.envVar?.key ?? item.key) === 'QBO_REFRESH_TOKEN'
               ? newToken
               : (item.envVar?.value ?? item.value),
    }));
    await axios.put(
      `https://api.render.com/v1/services/${serviceId}/env-vars`,
      vars,
      { headers },
    );
    console.log('[QBO] QBO_REFRESH_TOKEN synced to Render env vars (backup).');
  } catch (err) {
    console.warn('[QBO] Render env var sync failed (non-fatal):', err.response?.data ?? err.message);
  }
}

module.exports = { getQBOToken, getQBOClient };
