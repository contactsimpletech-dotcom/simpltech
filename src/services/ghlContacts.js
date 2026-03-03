'use strict';

const { getAuthenticatedClient, invalidateToken } = require('../auth/ghlAuth');
const { config }                                   = require('../config');

/**
 * Upsert a contact in GoHighLevel.
 *
 * Uses POST /contacts/upsert which creates the contact if none matches
 * the email/phone, or updates the existing one.
 *
 * GHL credentials are optional — if none are configured this is a no-op
 * so the payment flow is never blocked.
 *
 * @param {{ firstName: string, lastName?: string, email: string, phone?: string }} contact
 * @returns {Promise<object|null>} The GHL contact object, or null if skipped/failed.
 */
async function upsertContact({ firstName, lastName, email, phone }) {
  if (!config.ghl.apiKey && (!config.ghl.clientId || !config.ghl.clientSecret)) {
    console.warn('[ghl] No GHL credentials configured — skipping contact upsert.');
    return null;
  }

  if (!config.ghl.locationId) {
    console.warn('[ghl] GHL_LOCATION_ID not set — skipping contact upsert.');
    return null;
  }

  const body = {
    locationId: config.ghl.locationId,
    firstName,
    email,
  };
  if (lastName) body.lastName = lastName;
  if (phone)    body.phone    = phone;

  let client;
  try {
    client = await getAuthenticatedClient();
  } catch (err) {
    console.error('[ghl] Auth error — skipping contact upsert:', err.message);
    return null;
  }

  let response;
  try {
    response = await client.post('/contacts/upsert', body);
  } catch (err) {
    // 401 → stale token; invalidate so next call fetches a fresh one
    if (err.response?.status === 401) {
      invalidateToken();
    }
    console.error('[ghl] Contact upsert failed:', err.response?.data ?? err.message);
    return null;
  }

  return response.data?.contact ?? response.data ?? null;
}

module.exports = { upsertContact };
