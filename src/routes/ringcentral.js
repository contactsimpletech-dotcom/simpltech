'use strict';

/**
 * RingCentral webhook handler.
 *
 * Listens for call-recording events from RingCentral and posts a clickable
 * audio link as a note on the matching GoHighLevel contact.
 *
 * Setup:
 *   1. Set RC_WEBHOOK_VALIDATION_TOKEN in your .env (optional but recommended).
 *      RingCentral sends this token as a header on the first validation request.
 *   2. Register this URL as a RingCentral webhook subscription, pointing at:
 *        POST /api/ringcentral/recording
 *   3. Subscribe to the event filter:
 *        /restapi/v1.0/account/~/telephony/sessions?recordingStatus=Completed
 *      or the legacy:
 *        /restapi/v1.0/account/~/extension/~/telephony/sessions
 *
 * How it works:
 *   - When a call recording finishes, RingCentral POSTs a notification here.
 *   - We extract the recording content URL and the caller's phone number.
 *   - We upsert a GHL contact by phone number and add a note with the audio link.
 */

const { Router } = require('express');
const { upsertContact, addContactNote } = require('../services/ghlContacts');
const { config } = require('../config');

const router = Router();

// ─── RingCentral Webhook Validation ───────────────────────────────────────────
// RC sends a GET with a Validation-Token header during subscription setup.
router.get('/', (req, res) => {
  const token = req.headers['validation-token'];
  if (token) {
    return res.set('Validation-Token', token).status(200).send('');
  }
  res.json({ ok: true, service: 'ringcentral-webhook' });
});

// ─── Call Recording Notification ─────────────────────────────────────────────
router.post('/recording', async (req, res) => {
  // RC sends a Validation-Token header on the first POST during subscription
  // registration — just echo it back so the subscription activates.
  const validationToken = req.headers['validation-token'];
  if (validationToken) {
    return res.set('Validation-Token', validationToken).status(200).send('');
  }

  // Optional shared secret check (set RC_WEBHOOK_SECRET in .env).
  const secret = process.env.RC_WEBHOOK_SECRET;
  if (secret) {
    const provided = req.headers['x-rc-webhook-secret'] ?? '';
    if (provided !== secret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const body = req.body;

  // RingCentral wraps the real payload in a `body` property.
  const event = body?.body ?? body;

  try {
    await handleRecordingEvent(event);
  } catch (err) {
    console.error('[rc-webhook] Error processing recording event:', err.message);
    // Still return 200 so RC doesn't keep retrying for non-transient errors.
  }

  res.json({ ok: true });
});

// ─── Core Logic ───────────────────────────────────────────────────────────────

/**
 * Process a RingCentral telephony session event that contains a recording.
 *
 * Expected event shape (simplified):
 * {
 *   sessionId: "...",
 *   parties: [
 *     {
 *       direction: "Inbound" | "Outbound",
 *       from: { phoneNumber: "+15551234567", name: "Caller Name" },
 *       to:   { phoneNumber: "+15559876543" },
 *       recordings: [
 *         { id: "...", contentUri: "https://media.ringcentral.com/..." }
 *       ]
 *     }
 *   ]
 * }
 */
async function handleRecordingEvent(event) {
  const parties = event?.parties ?? [];

  for (const party of parties) {
    const recordings = party?.recordings ?? [];
    if (!recordings.length) continue;

    // Prefer the inbound (customer) side; fall back to any party with a recording.
    const callerPhone = party?.from?.phoneNumber;
    const callerName  = party?.from?.name ?? '';
    const sessionId   = event?.sessionId ?? 'unknown';

    for (const rec of recordings) {
      const recordingUrl = rec?.contentUri;
      if (!recordingUrl) continue;

      console.log(`[rc-webhook] Recording ready | session=${sessionId} caller=${callerPhone} url=${recordingUrl}`);

      // Upsert the GHL contact by phone number.
      // Split name into first/last if available.
      const nameParts  = callerName.trim().split(/\s+/);
      const firstName  = nameParts[0] || 'Unknown';
      const lastName   = nameParts.slice(1).join(' ') || undefined;

      const contact = await upsertContact({
        firstName,
        lastName,
        email: `rc-${callerPhone?.replace(/\D/g, '')}@ringcentral.placeholder`,
        phone: callerPhone,
      });

      if (!contact?.id) {
        console.warn('[rc-webhook] Could not upsert GHL contact — skipping note.');
        continue;
      }

      // Build the note with a clickable audio link.
      const noteBody = buildNoteBody({ recordingUrl, callerPhone, callerName, sessionId });

      await addContactNote(contact.id, noteBody);
      console.log(`[rc-webhook] Note added to GHL contact ${contact.id}`);
    }
  }
}

function buildNoteBody({ recordingUrl, callerPhone, callerName, sessionId }) {
  const lines = [
    '📞 RingCentral Call Recording',
    '',
    `Caller : ${callerName || callerPhone || 'Unknown'}`,
    `Phone  : ${callerPhone || 'N/A'}`,
    `Session: ${sessionId}`,
    '',
    '▶ Listen to recording:',
    recordingUrl,
  ];
  return lines.join('\n');
}

module.exports = router;
