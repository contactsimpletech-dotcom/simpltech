const axios = require('axios');
const config = require('../config');

function ghlClient() {
  return axios.create({
    baseURL: config.ghl.baseUrl,
    headers: {
      Authorization: `Bearer ${config.ghl.apiKey}`,
      Version: '2021-07-28',
      'Content-Type': 'application/json',
    },
  });
}

/**
 * Normalize a phone number to E.164-ish format for searching.
 * Strips all non-digit characters then prepends '+'.
 */
function normalizePhone(phone) {
  const digits = phone.replace(/\D/g, '');
  return `+${digits}`;
}

/**
 * Search GHL contacts by phone number.
 * Returns the first matching contact or null.
 */
async function findContactByPhone(phone) {
  const client = ghlClient();
  const normalized = normalizePhone(phone);

  try {
    const res = await client.get('/contacts/search', {
      params: {
        locationId: config.ghl.locationId,
        query: normalized,
      },
    });

    const contacts = res.data?.contacts || [];
    if (contacts.length > 0) {
      console.log(`[ghl] Found contact for ${normalized}: ${contacts[0].id}`);
      return contacts[0];
    }
  } catch (err) {
    console.error('[ghl] Contact search failed:', err.response?.data || err.message);
  }

  return null;
}

/**
 * Create a new GHL contact with just a phone number (and optional name).
 */
async function createContact(phone, firstName = '', lastName = '') {
  const client = ghlClient();
  const normalized = normalizePhone(phone);

  const res = await client.post('/contacts/', {
    locationId: config.ghl.locationId,
    phone: normalized,
    firstName: firstName || 'Unknown',
    lastName: lastName || 'Caller',
  });

  const contact = res.data?.contact;
  console.log(`[ghl] Created contact ${contact.id} for ${normalized}`);
  return contact;
}

/**
 * Find an existing contact by phone or create one if not found.
 */
async function findOrCreateContact(phone) {
  const existing = await findContactByPhone(phone);
  if (existing) return existing;

  console.log(`[ghl] No contact found for ${phone}, creating one...`);
  return createContact(phone);
}

/**
 * Add a note to a GHL contact.
 *
 * @param {string} contactId
 * @param {string} body       - Note text
 * @param {string} [userId]   - Optional GHL user ID to attribute the note to
 */
async function addNote(contactId, body, userId) {
  const client = ghlClient();

  const payload = { body };
  if (userId) payload.userId = userId;

  const res = await client.post(`/contacts/${contactId}/notes`, payload);
  const note = res.data?.note;
  console.log(`[ghl] Note added to contact ${contactId}: note ID ${note?.id}`);
  return note;
}

module.exports = { findOrCreateContact, addNote };
