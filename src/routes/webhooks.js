'use strict';

const { Router } = require('express');
const axios = require('axios');
const { getAPClient, invalidateAPToken } = require('../auth/apAuth');

const router = Router();

// ─── Helper ───────────────────────────────────────────────────────────────────

async function apRequest(fn) {
  let client = await getAPClient();
  try {
    return (await fn(client)).data;
  } catch (err) {
    if (err.response?.status === 401) {
      invalidateAPToken();
      client = await getAPClient();
      try { return (await fn(client)).data; } catch (e) { throw normalise(e); }
    }
    throw normalise(err);
  }
}

function normalise(err) {
  const d = err.response?.data ?? err.message;
  return new Error(`AP Webhooks API [${err.response?.status ?? 'N/A'}]: ${JSON.stringify(d)}`);
}

// ─── Subscriptions ────────────────────────────────────────────────────────────

/**
 * GET /api/webhooks
 * List webhook subscriptions.
 * Query: limit, after, before, topic, is_active
 */
router.get('/', async (req, res) => {
  try {
    const data = await apRequest((c) => c.get('/webhooks', { params: req.query }));
    res.json({ ok: true, ...data });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/webhooks
 * Subscribe to a webhook topic.
 *
 * Body:
 *   {
 *     endpoint_url : string  (required) — must be HTTPS
 *     topic        : string  (required) — e.g. "invoice_paid"
 *     secret_key?  : string  — sent as Bearer in Authorization header on delivery
 *   }
 */
router.post('/', async (req, res) => {
  const { endpoint_url, topic, secret_key } = req.body;
  if (!endpoint_url || !topic) {
    return res.status(400).json({ ok: false, error: '`endpoint_url` and `topic` are required.' });
  }
  try {
    const data = await apRequest((c) =>
      c.post('/webhooks', { endpoint_url, topic, ...(secret_key && { secret_key }) }),
    );
    res.status(201).json({ ok: true, ...data });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

/**
 * DELETE /api/webhooks/:id
 * Unsubscribe from a webhook.
 */
router.delete('/:id', async (req, res) => {
  try {
    await apRequest((c) => c.delete(`/webhooks/${req.params.id}`));
    res.json({ ok: true, message: `Subscription ${req.params.id} removed.` });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

// ─── Events ───────────────────────────────────────────────────────────────────

/**
 * GET /api/webhooks/events
 * List webhook delivery events.
 * Query: limit, after, before, topic, status, from_date, to_date
 */
router.get('/events', async (req, res) => {
  try {
    const data = await apRequest((c) => c.get('/webhooks/events', { params: req.query }));
    res.json({ ok: true, ...data });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/webhooks/retry
 * Manually retry all pending/failed webhooks after max retries reached.
 */
router.post('/retry', async (req, res) => {
  try {
    const data = await apRequest((c) => c.post('/webhooks/retry'));
    res.json({ ok: true, ...data });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

// ─── Idempotency store ────────────────────────────────────────────────────────
// In-memory set of processed idempotency keys. Prevents double-processing
// when AP retries a delivery. Capped at 10 000 entries; oldest evicted first.
const _seenKeys = new Set();
const _SEEN_MAX = 10_000;

function _markSeen(key) {
  if (_seenKeys.size >= _SEEN_MAX) {
    // Evict the oldest entry (insertion order).
    _seenKeys.delete(_seenKeys.values().next().value);
  }
  _seenKeys.add(key);
}

/**
 * POST /api/webhooks/receive
 *
 * Inbound webhook handler. Set AP_WEBHOOK_SECRET in .env to enable
 * Bearer-token verification. Each event is deduplicated by idempotency_key.
 */
router.post('/receive', (req, res) => {
  // ── Bearer token verification ────────────────────────────────────────────
  const secret = process.env.AP_WEBHOOK_SECRET;
  if (secret) {
    const auth = req.headers.authorization ?? '';
    if (!auth.startsWith('Bearer ') || auth.slice('Bearer '.length) !== secret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const { idempotency_key, topic, entity_id, data = {}, timestamp } = req.body;

  if (!idempotency_key) {
    return res.status(400).json({ error: 'Missing idempotency_key' });
  }

  // ── Replay protection ────────────────────────────────────────────────────
  if (_seenKeys.has(idempotency_key)) {
    console.log(`[Webhook] duplicate idempotency_key=${idempotency_key} — ignored`);
    return res.json({ message: 'Webhook already processed' });
  }
  _markSeen(idempotency_key);

  // Log the event — omit full data payload to avoid PII in logs.
  console.log(`[Webhook] ${timestamp} | ${topic} | entity=${entity_id} | key=${idempotency_key}`);

  res.json({ message: 'Webhook received' });
});

module.exports = router;
