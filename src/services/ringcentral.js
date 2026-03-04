'use strict';

const { getRCClient, invalidateRCToken } = require('../auth/ringcentralAuth');
const { config } = require('../config');

/**
 * Execute a request against the RingCentral REST API.
 * On a 401, the cached token is invalidated and the request retried once.
 *
 * @param {(client: import('axios').AxiosInstance) => Promise<import('axios').AxiosResponse>} fn
 */
async function withAuth(fn) {
  let client = await getRCClient();
  try {
    const res = await fn(client);
    return res.data;
  } catch (err) {
    if (err.response?.status === 401) {
      invalidateRCToken();
      client = await getRCClient();
      try {
        const res = await fn(client);
        return res.data;
      } catch (retryErr) {
        throw normaliseError(retryErr);
      }
    }
    throw normaliseError(err);
  }
}

function normaliseError(err) {
  const detail = err.response?.data ?? err.message;
  const status = err.response?.status ?? 'N/A';
  return new Error(`RingCentral API [${status}]: ${JSON.stringify(detail)}`);
}

/** Convenience: resolve account/extension path segment. */
function extPath(accountId, extensionId) {
  const a = accountId  ?? config.ringcentral.accountId  ?? '~';
  const e = extensionId ?? config.ringcentral.extensionId ?? '~';
  return `/restapi/v1.0/account/${a}/extension/${e}`;
}

// ─── SMS ──────────────────────────────────────────────────────────────────────

/**
 * Send an SMS from the configured RingCentral number.
 *
 * @param {{
 *   to          : string | string[],   // E.164 recipient number(s), e.g. "+15559876543"
 *   text        : string,              // SMS body (max ~1600 chars for multi-part)
 *   from?       : string,              // sender number; falls back to RC_FROM_NUMBER
 *   accountId?  : string,
 *   extensionId?: string,
 * }} opts
 * @returns {Promise<object>} RingCentral MessageInfo object.
 */
async function sendSMS(opts) {
  const fromNumber = opts.from ?? config.ringcentral.fromNumber;
  if (!fromNumber) {
    throw new Error('A sender number is required. Set RC_FROM_NUMBER or pass opts.from.');
  }

  const toNumbers = (Array.isArray(opts.to) ? opts.to : [opts.to]).map((n) => ({ phoneNumber: n }));

  const path = extPath(opts.accountId, opts.extensionId) + '/sms';

  return withAuth((c) =>
    c.post(path, {
      from: { phoneNumber: fromNumber },
      to:   toNumbers,
      text: opts.text,
    }),
  );
}

// ─── Messages ─────────────────────────────────────────────────────────────────

/**
 * List messages for an extension.
 *
 * @param {{
 *   messageType?: string,   // 'SMS' | 'Fax' | 'VoiceMail' | 'Pager' | 'Text'
 *   direction?  : string,   // 'Inbound' | 'Outbound'
 *   dateFrom?   : string,   // ISO date string
 *   dateTo?     : string,
 *   perPage?    : number,
 *   page?       : number,
 *   accountId?  : string,
 *   extensionId?: string,
 * }} [params]
 */
async function listMessages(params = {}) {
  const { accountId, extensionId, ...query } = params;
  const path = extPath(accountId, extensionId) + '/message-store';
  return withAuth((c) => c.get(path, { params: query }));
}

/**
 * Get a single message by ID.
 *
 * @param {string} messageId
 * @param {{ accountId?: string, extensionId?: string }} [opts]
 */
async function getMessage(messageId, opts = {}) {
  const path = extPath(opts.accountId, opts.extensionId) + `/message-store/${messageId}`;
  return withAuth((c) => c.get(path));
}

/**
 * Delete a message.
 *
 * @param {string} messageId
 * @param {{ accountId?: string, extensionId?: string }} [opts]
 */
async function deleteMessage(messageId, opts = {}) {
  const path = extPath(opts.accountId, opts.extensionId) + `/message-store/${messageId}`;
  return withAuth((c) => c.delete(path));
}

// ─── RingOut (click-to-call) ──────────────────────────────────────────────────

/**
 * Initiate a two-legged RingOut call.
 *
 * RingCentral first calls the `from` number, and when answered connects
 * it to the `to` number.
 *
 * @param {{
 *   to            : string,   // E.164 destination, e.g. "+15559876543"
 *   from          : string,   // E.164 caller number / extension
 *   callerId?     : string,   // E.164 number shown to `to` party (default: from)
 *   playPrompt?   : boolean,  // play "connecting" prompt to `from` leg (default: true)
 *   accountId?    : string,
 *   extensionId?  : string,
 * }} opts
 * @returns {Promise<object>} RingCentral RingOutInfo object.
 */
async function makeRingOut(opts) {
  const path = extPath(opts.accountId, opts.extensionId) + '/ring-out';

  return withAuth((c) =>
    c.post(path, {
      from:       { phoneNumber: opts.from },
      to:         { phoneNumber: opts.to },
      ...(opts.callerId && { callerId: { phoneNumber: opts.callerId } }),
      playPrompt: opts.playPrompt !== false,
    }),
  );
}

/**
 * Get the status of an active RingOut call.
 *
 * @param {string} ringOutId
 * @param {{ accountId?: string, extensionId?: string }} [opts]
 */
async function getRingOutStatus(ringOutId, opts = {}) {
  const path = extPath(opts.accountId, opts.extensionId) + `/ring-out/${ringOutId}`;
  return withAuth((c) => c.get(path));
}

/**
 * Cancel an active RingOut call.
 *
 * @param {string} ringOutId
 * @param {{ accountId?: string, extensionId?: string }} [opts]
 */
async function cancelRingOut(ringOutId, opts = {}) {
  const path = extPath(opts.accountId, opts.extensionId) + `/ring-out/${ringOutId}`;
  return withAuth((c) => c.delete(path));
}

// ─── Call Log ─────────────────────────────────────────────────────────────────

/**
 * List call log records for an extension.
 *
 * @param {{
 *   direction?     : string,    // 'Inbound' | 'Outbound'
 *   type?          : string,    // 'Voice' | 'Fax'
 *   dateFrom?      : string,
 *   dateTo?        : string,
 *   withRecording? : boolean,
 *   perPage?       : number,
 *   page?          : number,
 *   accountId?     : string,
 *   extensionId?   : string,
 * }} [params]
 */
async function listCallLog(params = {}) {
  const { accountId, extensionId, ...query } = params;
  const path = extPath(accountId, extensionId) + '/call-log';
  return withAuth((c) => c.get(path, { params: query }));
}

/**
 * Get a single call log record.
 *
 * @param {string} callId
 * @param {{ accountId?: string, extensionId?: string }} [opts]
 */
async function getCallLog(callId, opts = {}) {
  const path = extPath(opts.accountId, opts.extensionId) + `/call-log/${callId}`;
  return withAuth((c) => c.get(path));
}

// ─── Extension Info ───────────────────────────────────────────────────────────

/**
 * Get extension profile information (name, numbers, status, etc.).
 *
 * @param {{ accountId?: string, extensionId?: string }} [opts]
 */
async function getExtensionInfo(opts = {}) {
  const path = extPath(opts.accountId, opts.extensionId);
  return withAuth((c) => c.get(path));
}

// ─── Webhook subscriptions ────────────────────────────────────────────────────

/**
 * Create a push-notification subscription for RingCentral events.
 *
 * RingCentral supports WebHook (HTTPS), PubNub, and WebSocket delivery.
 * This helper creates an HTTPS webhook subscription.
 *
 * @param {{
 *   deliveryAddress : string,          // public HTTPS URL to receive events
 *   eventFilters    : string[],        // e.g. ['/restapi/v1.0/account/~/extension/~/message-store']
 *   expiresIn?      : number,          // seconds (default: 604800 = 7 days, max: 630720000)
 * }} opts
 * @returns {Promise<object>} RingCentral SubscriptionInfo object.
 */
async function createSubscription(opts) {
  return withAuth((c) =>
    c.post('/restapi/v1.0/subscription', {
      eventFilters: opts.eventFilters,
      deliveryMode: {
        transportType: 'WebHook',
        address:       opts.deliveryAddress,
      },
      ...(opts.expiresIn && { expiresIn: opts.expiresIn }),
    }),
  );
}

/**
 * List active subscriptions.
 */
async function listSubscriptions() {
  return withAuth((c) => c.get('/restapi/v1.0/subscription'));
}

/**
 * Renew a subscription before it expires.
 *
 * @param {string} subscriptionId
 */
async function renewSubscription(subscriptionId) {
  return withAuth((c) => c.put(`/restapi/v1.0/subscription/${subscriptionId}`));
}

/**
 * Delete a subscription.
 *
 * @param {string} subscriptionId
 */
async function deleteSubscription(subscriptionId) {
  return withAuth((c) => c.delete(`/restapi/v1.0/subscription/${subscriptionId}`));
}

// ─── High-level helpers ───────────────────────────────────────────────────────

/**
 * Send a payment-confirmation SMS to a customer.
 * Convenience wrapper around sendSMS with a pre-formatted message.
 *
 * @param {{
 *   to          : string,   // recipient E.164 number
 *   firstName   : string,
 *   amountCents : number,
 *   currency?   : string,
 *   invoiceId?  : string,
 * }} opts
 */
async function sendPaymentConfirmationSMS(opts) {
  const fmt = new Intl.NumberFormat('en-US', {
    style:    'currency',
    currency: opts.currency ?? 'USD',
  }).format(opts.amountCents / 100);

  let text = `Hi ${opts.firstName}, your payment of ${fmt} has been received.`;
  if (opts.invoiceId) text += ` Invoice ID: ${opts.invoiceId}.`;
  text += ' Thank you!';

  return sendSMS({ to: opts.to, text });
}

module.exports = {
  // SMS
  sendSMS,
  sendPaymentConfirmationSMS,
  // Messages
  listMessages,
  getMessage,
  deleteMessage,
  // RingOut
  makeRingOut,
  getRingOutStatus,
  cancelRingOut,
  // Call log
  listCallLog,
  getCallLog,
  // Extension
  getExtensionInfo,
  // Subscriptions
  createSubscription,
  listSubscriptions,
  renewSubscription,
  deleteSubscription,
};
