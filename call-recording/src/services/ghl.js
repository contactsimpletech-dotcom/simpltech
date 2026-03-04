const axios = require('axios');
const FormData = require('form-data');
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
 * Normalize a phone number to E.164 format for searching.
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
    const res = await client.get('/contacts/', {
      params: {
        locationId: config.ghl.locationId,
        query: normalized,
      },
    });

    const contacts = res.data?.contacts || [];
    if (contacts.length > 0) {
      console.log(`[ghl] Found existing contact for ${normalized}: ${contacts[0].id}`);
      return contacts[0];
    }
  } catch (err) {
    console.error('[ghl] Contact search failed:', err.response?.data || err.message);
  }

  return null;
}

/**
 * Create a new GHL contact with a phone number and name.
 * Falls back to "Unknown Caller" if no name was extracted from the transcript.
 */
async function createContact(phone, firstName, lastName) {
  const client = ghlClient();
  const normalized = normalizePhone(phone);

  const res = await client.post('/contacts/', {
    locationId: config.ghl.locationId,
    phone: normalized,
    firstName: firstName || 'Unknown',
    lastName: lastName || 'Caller',
  });

  const contact = res.data?.contact;
  console.log(`[ghl] Created contact ${contact.id} (${firstName} ${lastName}) for ${normalized}`);
  return contact;
}

/**
 * Upload an audio buffer to the GHL media library.
 * Returns the CDN URL of the uploaded file, or null on failure.
 */
async function uploadAudio(buffer, contentType, id) {
  const ext = contentType.includes('wav') ? 'wav' : 'mp3';
  const filename = `recording-${id}.${ext}`;

  const form = new FormData();
  form.append('file', buffer, { filename, contentType });
  form.append('locationId', config.ghl.locationId);

  try {
    const res = await axios.post(
      `${config.ghl.baseUrl}/medias/upload-file`,
      form,
      {
        headers: {
          Authorization: `Bearer ${config.ghl.apiKey}`,
          Version: '2021-07-28',
          ...form.getHeaders(),
        },
      }
    );

    const url = res.data?.url || res.data?.data?.url || null;
    if (url) console.log(`[ghl] Audio uploaded: ${url}`);
    return url;
  } catch (err) {
    console.error('[ghl] Audio upload failed:', err.response?.data || err.message);
    return null;
  }
}

/**
 * Add a note to a GHL contact.
 */
async function addNote(contactId, body) {
  const client = ghlClient();

  const res = await client.post(`/contacts/${contactId}/notes`, { body });
  const note = res.data?.note;
  console.log(`[ghl] Note added to contact ${contactId}: note ID ${note?.id}`);
  return note;
}

module.exports = { findContactByPhone, createContact, addNote, uploadAudio };
