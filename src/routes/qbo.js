'use strict';

const { Router } = require('express');
const axios      = require('axios');
const { config } = require('../config');
const tokenStore = require('../store/tokenStore');

const router = Router();

const INTUIT_AUTH_URL  = 'https://appcenter.intuit.com/connect/oauth2';
const INTUIT_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const QBO_SCOPE        = 'com.intuit.quickbooks.accounting';

/**
 * GET /api/qbo/connect
 *
 * Redirects to Intuit's OAuth 2.0 authorization page.
 * After the user authorises, Intuit sends them back to /api/qbo/callback.
 *
 * Requires QBO_CLIENT_ID and QBO_CLIENT_SECRET to be set in env.
 */
router.get('/connect', (req, res) => {
  if (!config.qbo.clientId || !config.qbo.clientSecret) {
    return res.status(400).send(`
      <pre>Set QBO_CLIENT_ID and QBO_CLIENT_SECRET in Render first, then visit this page.</pre>
    `);
  }

  const params = new URLSearchParams({
    client_id:     config.qbo.clientId,
    scope:         QBO_SCOPE,
    redirect_uri:  `${config.qbo.redirectBase}/api/qbo/callback`,
    response_type: 'code',
    state:         'simpltech-qbo',
  });

  return res.redirect(`${INTUIT_AUTH_URL}?${params}`);
});

/**
 * GET /api/qbo/callback
 *
 * Intuit redirects here after the user authorises the app.
 * Exchanges the one-time code for access + refresh tokens, saves them to the
 * persistent token store, and updates the in-memory config.
 *
 * No manual copy-paste step is required — the app is ready immediately.
 */
router.get('/callback', async (req, res) => {
  const { code, realmId, error } = req.query;

  if (error) {
    return res.status(400).send(`<pre>Intuit returned an error: ${error}</pre>`);
  }

  if (!code || !realmId) {
    return res.status(400).send('<pre>Missing code or realmId in callback.</pre>');
  }

  const credential = Buffer.from(
    `${config.qbo.clientId}:${config.qbo.clientSecret}`,
  ).toString('base64');

  let data;
  try {
    const response = await axios.post(
      INTUIT_TOKEN_URL,
      new URLSearchParams({
        grant_type:   'authorization_code',
        code,
        redirect_uri: `${config.qbo.redirectBase}/api/qbo/callback`,
      }).toString(),
      {
        headers: {
          Authorization:  `Basic ${credential}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept:         'application/json',
        },
      },
    );
    data = response.data;
  } catch (err) {
    const detail = err.response?.data ?? err.message;
    return res.status(502).send(
      `<pre>Token exchange failed:\n${JSON.stringify(detail, null, 2)}</pre>`,
    );
  }

  // ── Persist tokens to the store (the DB) ─────────────────────────────────
  tokenStore.save({
    qbo_refresh_token: data.refresh_token,
    qbo_realm_id:      realmId,
  });

  // ── Update in-memory config so subsequent calls in this process work ──────
  config.qbo.refreshToken = data.refresh_token;
  config.qbo.realmId      = realmId;

  console.log('[QBO] OAuth complete. Tokens saved to store. realmId:', realmId);

  // ── Confirm to the user — no manual copy step needed ─────────────────────
  return res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>QuickBooks Connected — SimplTech</title>
  <style>
    body { font-family: -apple-system, sans-serif; padding: 40px 24px; max-width: 680px; color: #111; }
    h2   { color: #166534; }
    .box { background: #f0fdf4; border: 1.5px solid #86efac; border-radius: 10px; padding: 20px 24px; margin: 20px 0; }
    .row { display: flex; justify-content: space-between; align-items: center; margin: 10px 0; }
    .label { font-weight: 700; color: #166534; font-size: .9rem; min-width: 160px; }
    .val  { font-family: monospace; font-size: .85rem; background: #fff; border: 1px solid #d1fae5;
            border-radius: 6px; padding: 6px 10px; word-break: break-all; }
    .info { background: #eff6ff; border: 1px solid #93c5fd; border-radius: 8px;
            padding: 14px 18px; margin-top: 20px; color: #1e40af; font-size: .9rem; }
    .step { margin: 6px 0; }
  </style>
</head>
<body>
  <h2>QuickBooks Connected!</h2>
  <p>Tokens saved automatically — no copy-paste required.</p>

  <div class="box">
    <div class="row">
      <span class="label">Realm ID</span>
      <span class="val">${realmId}</span>
    </div>
    <div class="row">
      <span class="label">Refresh token</span>
      <span class="val">saved to store ✓</span>
    </div>
    <div class="row">
      <span class="label">Store path</span>
      <span class="val">${tokenStore.STORE_PATH}</span>
    </div>
  </div>

  <div class="info">
    <strong>What happens next:</strong>
    <div class="step">• Every token rotation is written to the store automatically.</div>
    <div class="step">• You never need to copy tokens to Render env vars again.</div>
    <div class="step">• The refresh token expires in <strong>100 days</strong> — revisit
      <code>/api/qbo/connect</code> before then to renew.</div>
  </div>
</body>
</html>`);
});

/**
 * GET /api/qbo/status
 *
 * Debug endpoint — shows whether QBO is configured and what token is loaded.
 * Tokens are masked; safe to visit in a browser.
 */
router.get('/status', (req, res) => {
  const q  = config.qbo;
  const rt = q.refreshToken;
  const masked = rt
    ? `${rt.slice(0, 10)}…${rt.slice(-6)}  (${rt.length} chars)`
    : null;

  const stored = tokenStore.load();

  res.json({
    enabled:      !!(q.clientId && q.clientSecret && q.realmId && rt),
    environment:  q.environment,
    realmId:      q.realmId  || '(not set)',
    clientId:     q.clientId ? `${q.clientId.slice(0, 6)}…` : '(not set)',
    refreshToken: masked     || '(not set)',
    store: {
      path:       tokenStore.STORE_PATH,
      hasToken:   !!stored.qbo_refresh_token,
      hasRealmId: !!stored.qbo_realm_id,
      updatedAt:  stored.updated_at || null,
    },
    renderApiAutoUpdate: !!(process.env.RENDER_API_KEY && process.env.RENDER_SERVICE_ID),
  });
});

module.exports = router;
