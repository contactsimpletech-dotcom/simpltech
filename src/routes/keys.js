'use strict';

const { Router } = require('express');
const { getAccessToken, authMode } = require('../auth/ghlAuth');
const { config } = require('../config');

const router = Router();

/**
 * GET /api/keys/token
 *
 * Verify the configured GHL credential and return a masked token preview.
 *
 * - PIT mode  : confirms the key is present (no network call required).
 * - OAuth mode: performs the token exchange and confirms it succeeds.
 *
 * Intended for internal health-checks / credential validation only.
 */
router.get('/token', async (req, res) => {
  try {
    const token = await getAccessToken();
    const mode  = authMode();

    res.json({
      ok: true,
      authMode: mode,
      message:
        mode === 'pit'
          ? 'GoHighLevel Private Integration Token is configured.'
          : 'GoHighLevel OAuth token exchange succeeded.',
      credentials:
        mode === 'pit'
          ? { apiKey: maskSecret(config.ghl.apiKey) }
          : { clientId: maskSecret(config.ghl.clientId), tokenUrl: config.ghl.tokenUrl },
      // Show only the first/last 6 chars — enough to confirm identity without
      // leaking the full secret into logs or browser history.
      tokenPreview: `${token.slice(0, 6)}…${token.slice(-6)}`,
    });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/keys/config
 *
 * Return masked configuration so operators can verify what credentials and
 * endpoints are in use without exposing secrets.
 */
router.get('/config', (req, res) => {
  const mode = authMode();

  res.json({
    ok: true,
    authMode: mode,
    config: {
      ...(mode === 'pit'
        ? { apiKey: maskSecret(config.ghl.apiKey) }
        : {
            clientId: maskSecret(config.ghl.clientId),
            tokenUrl: config.ghl.tokenUrl,
          }),
      apiBaseUrl: config.ghl.apiBaseUrl,
      locationId: config.ghl.locationId ?? '(not set)',
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
