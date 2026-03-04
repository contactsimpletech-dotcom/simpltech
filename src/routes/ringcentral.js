'use strict';

const { Router } = require('express');
const { getRCToken }                        = require('../auth/ringcentralAuth');
const {
  sendSMS,
  listMessages,
  getMessage,
  deleteMessage,
  makeRingOut,
  getRingOutStatus,
  cancelRingOut,
  listCallLog,
  getCallLog,
  getExtensionInfo,
  createSubscription,
  listSubscriptions,
  renewSubscription,
  deleteSubscription,
}                                           = require('../services/ringcentral');
const { ringcentralEnabled }               = require('../config');

const router = Router();

// ─── Health / Token check ─────────────────────────────────────────────────────

/**
 * GET /api/ringcentral/token
 *
 * Verify credentials by attempting a live JWT token exchange.
 */
router.get('/token', async (_req, res) => {
  if (!ringcentralEnabled()) {
    return res.status(503).json({
      ok: false,
      error: 'RingCentral is not configured. Set RC_CLIENT_ID, RC_CLIENT_SECRET, and RC_JWT_TOKEN.',
    });
  }

  try {
    const token = await getRCToken();
    res.json({
      ok: true,
      message: 'RingCentral JWT token exchange succeeded.',
      tokenPreview: `${token.slice(0, 8)}…${token.slice(-4)}`,
    });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

// ─── Extension ────────────────────────────────────────────────────────────────

/**
 * GET /api/ringcentral/extension
 *
 * Returns the extension profile (name, phone numbers, status, etc.).
 */
router.get('/extension', async (_req, res) => {
  try {
    const data = await getExtensionInfo();
    res.json({ ok: true, extension: data });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

// ─── SMS ──────────────────────────────────────────────────────────────────────

/**
 * POST /api/ringcentral/sms
 *
 * Send an outbound SMS.
 *
 * Body:
 *   {
 *     to   : string | string[],   // E.164 recipient(s), e.g. "+15559876543"
 *     text : string,              // message body
 *     from?: string               // sender number (overrides RC_FROM_NUMBER)
 *   }
 */
router.post('/sms', async (req, res) => {
  const { to, text, from } = req.body;

  if (!to || !text) {
    return res.status(400).json({ ok: false, error: '`to` and `text` are required.' });
  }

  try {
    const message = await sendSMS({ to, text, from });
    res.status(201).json({ ok: true, message });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

// ─── Messages ─────────────────────────────────────────────────────────────────

/**
 * GET /api/ringcentral/messages
 *
 * List messages for the configured extension.
 * Query: messageType, direction, dateFrom, dateTo, perPage, page
 */
router.get('/messages', async (req, res) => {
  try {
    const data = await listMessages(req.query);
    res.json({ ok: true, ...data });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/ringcentral/messages/:id
 *
 * Get a single message by ID.
 */
router.get('/messages/:id', async (req, res) => {
  try {
    const data = await getMessage(req.params.id);
    res.json({ ok: true, message: data });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

/**
 * DELETE /api/ringcentral/messages/:id
 *
 * Delete a message.
 */
router.delete('/messages/:id', async (req, res) => {
  try {
    await deleteMessage(req.params.id);
    res.json({ ok: true, message: `Message ${req.params.id} deleted.` });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

// ─── RingOut ──────────────────────────────────────────────────────────────────

/**
 * POST /api/ringcentral/ringout
 *
 * Initiate a two-legged RingOut call.
 *
 * Body:
 *   {
 *     to        : string,   // E.164 destination
 *     from      : string,   // E.164 caller / extension that rings first
 *     callerId? : string,   // number shown to `to` party
 *     playPrompt?: boolean  // default: true
 *   }
 */
router.post('/ringout', async (req, res) => {
  const { to, from, callerId, playPrompt } = req.body;

  if (!to || !from) {
    return res.status(400).json({ ok: false, error: '`to` and `from` are required.' });
  }

  try {
    const data = await makeRingOut({ to, from, callerId, playPrompt });
    res.status(201).json({ ok: true, ringout: data });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/ringcentral/ringout/:id
 *
 * Get the status of an active RingOut call.
 */
router.get('/ringout/:id', async (req, res) => {
  try {
    const data = await getRingOutStatus(req.params.id);
    res.json({ ok: true, ringout: data });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

/**
 * DELETE /api/ringcentral/ringout/:id
 *
 * Cancel an active RingOut call.
 */
router.delete('/ringout/:id', async (req, res) => {
  try {
    await cancelRingOut(req.params.id);
    res.json({ ok: true, message: `RingOut ${req.params.id} cancelled.` });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

// ─── Call Log ─────────────────────────────────────────────────────────────────

/**
 * GET /api/ringcentral/call-log
 *
 * List call log records for the extension.
 * Query: direction, type, dateFrom, dateTo, withRecording, perPage, page
 */
router.get('/call-log', async (req, res) => {
  try {
    const data = await listCallLog(req.query);
    res.json({ ok: true, ...data });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/ringcentral/call-log/:id
 *
 * Get a single call log record.
 */
router.get('/call-log/:id', async (req, res) => {
  try {
    const data = await getCallLog(req.params.id);
    res.json({ ok: true, call: data });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

// ─── Push subscriptions ───────────────────────────────────────────────────────

/**
 * GET /api/ringcentral/subscriptions
 *
 * List active RingCentral push subscriptions.
 */
router.get('/subscriptions', async (_req, res) => {
  try {
    const data = await listSubscriptions();
    res.json({ ok: true, ...data });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/ringcentral/subscriptions
 *
 * Create a WebHook push subscription.
 *
 * Body:
 *   {
 *     deliveryAddress : string,     // public HTTPS URL to receive events
 *     eventFilters    : string[],   // e.g. ["/restapi/v1.0/account/~/extension/~/message-store"]
 *     expiresIn?      : number      // seconds (default RingCentral max: 604800)
 *   }
 */
router.post('/subscriptions', async (req, res) => {
  const { deliveryAddress, eventFilters, expiresIn } = req.body;

  if (!deliveryAddress || !Array.isArray(eventFilters) || eventFilters.length === 0) {
    return res.status(400).json({
      ok: false,
      error: '`deliveryAddress` (string) and `eventFilters` (non-empty array) are required.',
    });
  }

  try {
    const data = await createSubscription({ deliveryAddress, eventFilters, expiresIn });
    res.status(201).json({ ok: true, subscription: data });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

/**
 * PUT /api/ringcentral/subscriptions/:id/renew
 *
 * Renew a subscription before it expires.
 */
router.put('/subscriptions/:id/renew', async (req, res) => {
  try {
    const data = await renewSubscription(req.params.id);
    res.json({ ok: true, subscription: data });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

/**
 * DELETE /api/ringcentral/subscriptions/:id
 *
 * Delete a subscription.
 */
router.delete('/subscriptions/:id', async (req, res) => {
  try {
    await deleteSubscription(req.params.id);
    res.json({ ok: true, message: `Subscription ${req.params.id} deleted.` });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

// ─── Inbound event receiver ───────────────────────────────────────────────────

/**
 * POST /api/ringcentral/events
 *
 * Receive inbound push events from RingCentral.
 *
 * RingCentral sends a Validation-Token header on the first request to verify
 * the endpoint — the server must echo it back as-is.  Subsequent event
 * payloads carry a JSON body.
 *
 * Set RC_WEBHOOK_SECRET in .env to enable simple Bearer-token verification.
 */
router.post('/events', (req, res) => {
  // ── Endpoint validation handshake ───────────────────────────────────────────
  const validationToken = req.headers['validation-token'];
  if (validationToken) {
    res.setHeader('Validation-Token', validationToken);
    return res.status(200).send();
  }

  // ── Optional secret verification ────────────────────────────────────────────
  const secret = process.env.RC_WEBHOOK_SECRET;
  if (secret) {
    const auth = req.headers.authorization ?? '';
    if (!auth.startsWith('Bearer ') || auth.replace('Bearer ', '') !== secret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const { uuid, event, timestamp, subscriptionId, body = {} } = req.body ?? {};

  if (!uuid) {
    return res.status(400).json({ error: 'Missing event uuid' });
  }

  // Log the event — replace with your own queue / business logic.
  console.log(`[RC Event] ${timestamp} | ${event} | sub=${subscriptionId}`, body);

  res.status(200).json({ ok: true });
});

module.exports = router;
