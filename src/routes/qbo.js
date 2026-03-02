'use strict';

const { Router } = require('express');
const axios      = require('axios');
const { config } = require('../config');

const router = Router();

const INTUIT_AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2';
const INTUIT_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const QBO_SCOPE = 'com.intuit.quickbooks.accounting';

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
 * Exchanges the one-time code for access + refresh tokens and displays
 * the values the user needs to copy into Render.
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

  // ── Display tokens for the user to copy into Render ──────────────────────────
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
    .label { font-weight: 700; color: #166534; font-size: .9rem; min-width: 200px; }
    .val  { font-family: monospace; font-size: .85rem; background: #fff; border: 1px solid #d1fae5;
            border-radius: 6px; padding: 6px 10px; word-break: break-all; }
    .warn { background: #fefce8; border: 1px solid #fde047; border-radius: 8px;
            padding: 14px 18px; margin-top: 20px; color: #854d0e; font-size: .9rem; }
    .step { margin: 6px 0; }
  </style>
</head>
<body>
  <h2>QuickBooks Connected!</h2>
  <p>Copy these two values into Render → your service → Environment:</p>

  <div class="box">
    <div class="row">
      <span class="label">QBO_REALM_ID</span>
      <span class="val">${realmId}</span>
    </div>
    <div class="row">
      <span class="label">QBO_REFRESH_TOKEN</span>
      <span class="val">${data.refresh_token}</span>
    </div>
  </div>

  <div class="warn">
    <strong>Important:</strong>
    <div class="step">• The refresh token expires in <strong>100 days</strong>.</div>
    <div class="step">• Before it expires, visit <code>/api/qbo/connect</code> again to renew it.</div>
    <div class="step">• After saving in Render, redeploy the service.</div>
  </div>
</body>
</html>`);
});

module.exports = router;
