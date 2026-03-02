'use strict';

const axios = require('axios');
const fs    = require('fs');
const path  = require('path');

const { config } = require('../config');

const TOKEN_URL  = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';

// Survives process restarts; wiped on fresh deploys (Render ephemeral FS).
const STATE_FILE = path.join('/tmp', 'qbo_state.json');

const tokenCache = {
  accessToken: null,
  expiresAt: 0,
};

// ── On startup: restore a previously-rotated token from disk ─────────────────
// If the server restarted (not redeployed) and QBO had already rotated the
// token, this lets us pick up the current valid token instead of the stale
// one stored in the Render env var.
(function restoreFromDisk() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const { refreshToken } = JSON.parse(raw);
    if (refreshToken && refreshToken !== config.qbo.refreshToken) {
      config.qbo.refreshToken = refreshToken;
      console.log('[QBO] Restored rotated refresh token from disk.');
    }
  } catch (_) { /* no file — use env var as-is */ }
}());

// ── Persist rotated token to disk ────────────────────────────────────────────
function saveToDisk(refreshToken) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ refreshToken }));
  } catch (err) {
    console.warn('[QBO] Could not write token to disk:', err.message);
  }
}

// ── Auto-update Render env var via Render API (optional) ────────────────────
// Set RENDER_API_KEY + RENDER_SERVICE_ID to enable automatic rotation.
// Without these, you must manually copy the new token from logs → Render.
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
    // Render returns an array of { envVar: { key, value } }
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
    console.log('[QBO] QBO_REFRESH_TOKEN auto-updated in Render env vars.');
  } catch (err) {
    console.warn('[QBO] Could not auto-update Render env var:', err.response?.data ?? err.message);
  }
}

/**
 * Exchange the stored QBO refresh token for a short-lived access token.
 * Tokens are cached in memory and auto-refreshed on expiry.
 *
 * When QBO rotates the refresh token the new value is:
 *   1. Written to /tmp/qbo_state.json (survives restarts)
 *   2. Pushed to Render env var if RENDER_API_KEY + RENDER_SERVICE_ID are set
 *   3. Printed to stdout so you can copy it to Render manually if needed
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

  // QBO rotates the refresh token on each use — persist the new one.
  if (refresh_token && refresh_token !== config.qbo.refreshToken) {
    config.qbo.refreshToken = refresh_token;
    saveToDisk(refresh_token);
    updateRenderEnvVar(refresh_token).catch(() => {}); // fire-and-forget
    console.warn(
      '[QBO] New refresh token issued. If not using RENDER_API_KEY, ' +
      'update QBO_REFRESH_TOKEN in Render manually:\n',
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

module.exports = { getQBOToken, getQBOClient };
