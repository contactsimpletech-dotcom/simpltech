'use strict';

const { Router } = require('express');
const { getAccessToken } = require('../auth/ghlAuth');
const { config } = require('../config');

const router = Router();

/**
 * GET /api/keys/token
 *
 * Exchange the configured GHL client_id/client_secret for a bearer token and
 * return it (along with masked credential info) so the caller can verify that
 * the API key is working.
 *
 * In production you would NOT expose the raw token to the client — this
 * endpoint is intended for internal health-checks and initial configuration
 * validation.
 */
router.get('/token', async (req, res) => {
  try {
    const token = await getAccessToken();

    res.json({
      ok: true,
      message: 'GoHighLevel API key is valid and token exchange succeeded.',
      credentials: {
        clientId: maskSecret(config.ghl.clientId),
        tokenUrl: config.ghl.tokenUrl,
      },
      // Return only the first / last 6 chars so the token is verifiable but
      // not fully exposed in logs or browser history.
      tokenPreview: `${token.slice(0, 6)}…${token.slice(-6)}`,
    });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/keys/config
 *
 * Return the current (masked) configuration so operators can verify which
 * credentials and endpoints are in use without exposing secrets.
 */
router.get('/config', (req, res) => {
  res.json({
    ok: true,
    config: {
      clientId: maskSecret(config.ghl.clientId),
      tokenUrl: config.ghl.tokenUrl,
      apiBaseUrl: config.ghl.apiBaseUrl,
      presetAmount: config.payment.presetAmount,
      presetAmountFormatted: formatCents(config.payment.presetAmount, config.payment.currency),
      currency: config.payment.currency,
    },
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function maskSecret(secret) {
  if (!secret || secret.length < 8) return '***';
  return `${secret.slice(0, 4)}${'*'.repeat(secret.length - 8)}${secret.slice(-4)}`;
}

function formatCents(cents, currency) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

module.exports = router;
