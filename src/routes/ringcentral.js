'use strict';

const { Router } = require('express');
const { sendSms, getCallLog, getExtensionInfo } = require('../services/ringCentral');
const { getRCToken }                             = require('../auth/ringCentralAuth');

const router = Router();

/**
 * GET /api/ringcentral/status
 *
 * Verifies RingCentral credentials by fetching a token and extension info.
 * Safe to call at any time — no side effects.
 */
router.get('/status', async (req, res) => {
  try {
    const [token, info] = await Promise.all([getRCToken(), getExtensionInfo()]);
    res.json({
      ok: true,
      tokenPreview: `${token.slice(0, 8)}…${token.slice(-4)}`,
      extension: {
        id:     info.id,
        name:   info.name,
        type:   info.type,
        status: info.status,
      },
    });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/ringcentral/sms
 *
 * Send an SMS message via RingCentral.
 *
 * Body (JSON):
 *   to   — required  E.164 number e.g. "+15551234567"
 *   text — required  Message body (max 1000 chars)
 *   from — optional  Override the default RC_FROM_NUMBER
 */
router.post('/sms', async (req, res) => {
  const { to, text, from } = req.body;

  if (!to || !text) {
    return res.status(400).json({ ok: false, error: '`to` and `text` are required.' });
  }

  try {
    const result = await sendSms({ to, text, from });
    res.status(201).json({ ok: true, ...result });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/ringcentral/call-log
 *
 * Retrieve the account call log.
 *
 * Query params (all optional):
 *   dateFrom  — ISO date-time e.g. "2026-01-01T00:00:00Z"
 *   dateTo    — ISO date-time
 *   direction — "Inbound" | "Outbound"
 *   type      — "Voice" | "Fax"
 *   perPage   — integer (max 1000)
 *   page      — integer
 */
router.get('/call-log', async (req, res) => {
  try {
    const data = await getCallLog(req.query);
    res.json({ ok: true, ...data });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

module.exports = router;
