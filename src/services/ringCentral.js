'use strict';

const { getRCClient, invalidateRCToken } = require('../auth/ringCentralAuth');
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

// ─── SMS ──────────────────────────────────────────────────────────────────────

/**
 * Send an SMS via RingCentral.
 *
 * @param {{
 *   to   : string,   // recipient E.164 phone number e.g. "+15551234567"
 *   text : string,   // message body (max 1000 chars for standard SMS)
 *   from?: string    // sender number; falls back to RC_FROM_NUMBER
 * }} opts
 * @returns {Promise<object>} RingCentral message object
 */
async function sendSms({ to, text, from }) {
  const { accountId, extensionId, fromNumber } = config.ringCentral;
  const fromNum = from ?? fromNumber;

  if (!fromNum) {
    throw new Error(
      'A sender phone number is required. ' +
      'Set RC_FROM_NUMBER in env or pass `from` in the request body.',
    );
  }

  return withAuth((c) =>
    c.post(`/account/${accountId}/extension/${extensionId}/sms`, {
      from: { phoneNumber: fromNum },
      to:   [{ phoneNumber: to }],
      text,
    }),
  );
}

// ─── Call Log ─────────────────────────────────────────────────────────────────

/**
 * Retrieve the account-level call log.
 *
 * @param {{
 *   dateFrom?      : string,   // ISO date-time e.g. "2026-01-01T00:00:00Z"
 *   dateTo?        : string,
 *   direction?     : 'Inbound' | 'Outbound',
 *   type?          : 'Voice' | 'Fax',
 *   perPage?       : number,
 *   page?          : number
 * }} [params]
 * @returns {Promise<object>}
 */
async function getCallLog(params = {}) {
  const { accountId } = config.ringCentral;
  return withAuth((c) => c.get(`/account/${accountId}/call-log`, { params }));
}

// ─── Extension ────────────────────────────────────────────────────────────────

/**
 * Retrieve info for the configured extension.
 * Useful for verifying credentials and checking account status.
 *
 * @returns {Promise<object>}
 */
async function getExtensionInfo() {
  const { accountId, extensionId } = config.ringCentral;
  return withAuth((c) => c.get(`/account/${accountId}/extension/${extensionId}`));
}

// ─── High-level helpers ───────────────────────────────────────────────────────

/**
 * Optionally notify a contact by SMS.
 *
 * This is a fire-and-forget wrapper — it logs errors but never throws,
 * so callers (e.g. the agreement flow) are never blocked by RC failures.
 *
 * @param {{ phone?: string, firstName?: string }} contact
 * @param {string} text  SMS body
 * @returns {Promise<object|null>}
 */
async function notifyContact(contact, text) {
  const rc = config.ringCentral;
  if (!rc.clientId || !rc.clientSecret || !rc.jwt) {
    console.warn('[rc] RingCentral not configured — skipping SMS notification.');
    return null;
  }

  if (!contact?.phone) {
    console.warn('[rc] Contact has no phone number — skipping SMS notification.');
    return null;
  }

  try {
    return await sendSms({ to: contact.phone, text });
  } catch (err) {
    console.error('[rc] SMS notification failed:', err.message);
    return null;
  }
}

module.exports = {
  sendSms,
  getCallLog,
  getExtensionInfo,
  notifyContact,
};
