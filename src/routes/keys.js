'use strict';

const { Router } = require('express');
const { getAPToken } = require('../auth/apAuth');
const { getAccessToken, ghlAuthMode } = require('../auth/ghlAuth');
const { config } = require('../config');

const router = Router();

/**
 * GET /api/keys/token
 *
 * Verify BOTH the GHL key and the Alternative Payments API key by attempting
 * live token resolutions and returning masked previews.
 */
router.get('/token', async (req, res) => {
  const results = {};

  // ── GHL ──────────────────────────────────────────────────────────────────
  try {
    const token  = await getAccessToken();
    const mode   = ghlAuthMode();
    results.ghl  = {
      ok: true,
      authMode: mode,
      message: mode === 'pit' ? 'PIT token confirmed.' : 'OAuth token exchange succeeded.',
      tokenPreview: `${token.slice(0, 8)}…${token.slice(-4)}`,
    };
  } catch (err) {
    results.ghl = { ok: false, error: err.message };
  }

  // ── Alternative Payments ──────────────────────────────────────────────────
  try {
    const token      = await getAPToken();
    results.ap       = {
      ok: true,
      message: 'Alternative Payments OAuth token exchange succeeded.',
      tokenPreview: `${token.slice(0, 8)}…${token.slice(-4)}`,
    };
  } catch (err) {
    results.ap = { ok: false, error: err.message };
  }

  const allOk = results.ghl.ok && results.ap.ok;
  res.status(allOk ? 200 : 502).json({ ok: allOk, results });
});

/**
 * GET /api/keys/config
 *
 * Return masked configuration for both systems.
 */
router.get('/config', (req, res) => {
  const mode = ghlAuthMode();
  res.json({
    ok: true,
    ghl: {
      authMode: mode,
      ...(mode === 'pit'
        ? { apiKey: maskSecret(config.ghl.apiKey) }
        : { clientId: maskSecret(config.ghl.clientId) }),
      apiBaseUrl: config.ghl.apiBaseUrl,
      locationId: config.ghl.locationId ?? '(not set)',
    },
    alternativePayments: {
      apiKey: maskSecret(config.ap.apiKey),
      tokenUrl: config.ap.tokenUrl,
      apiBaseUrl: config.ap.apiBaseUrl,
    },
    payment: {
      presetAmount: config.payment.presetAmount,
      presetAmountFormatted: formatCents(config.payment.presetAmount, config.payment.currency),
      currency: config.payment.currency,
    },
  });
});

function maskSecret(s) {
  if (!s || s.length < 8) return '***';
  return `${s.slice(0, 4)}${'*'.repeat(s.length - 8)}${s.slice(-4)}`;
}

function formatCents(cents, currency) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

module.exports = router;
