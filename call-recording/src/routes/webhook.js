const express = require('express');
const { downloadRecording } = require('../services/ringcentral');
const { transcribe } = require('../services/transcription');
const { findOrCreateContact, addNote } = require('../services/ghl');

const router = express.Router();

/**
 * POST /webhook/ringcentral
 *
 * Receives RingCentral telephony session event notifications.
 *
 * RingCentral first validates the endpoint by sending a request with a
 * "Validation-Token" header — we must echo it back immediately.
 *
 * After validation, RC sends JSON event bodies whenever a telephony session
 * changes state. We look for parties that have:
 *   - status.code === "Disconnected"   (call ended)
 *   - recordings[] array with entries  (recording is attached)
 *
 * For each such recording we:
 *   1. Download the audio from RingCentral
 *   2. Transcribe it with OpenAI Whisper
 *   3. Find or create a GHL contact for the caller's phone number
 *   4. Post the transcript as a note on that contact
 */
router.post('/ringcentral', async (req, res) => {
  // ── Validation handshake ──────────────────────────────────────────────────
  const validationToken = req.headers['validation-token'];
  if (validationToken) {
    console.log('[webhook] RingCentral validation handshake received');
    return res.status(200).set('Validation-Token', validationToken).send();
  }

  // Acknowledge receipt immediately so RC doesn't retry
  res.status(200).json({ received: true });

  // ── Parse event body ──────────────────────────────────────────────────────
  const body = req.body;

  // RC can wrap the payload in a "body" field
  const event = body?.body ?? body;

  if (!event) {
    console.warn('[webhook] Empty event body, skipping');
    return;
  }

  const parties = event.parties || [];
  const sessionId = event.telephonySessionId || event.sessionId || 'unknown';

  console.log(`[webhook] Telephony session ${sessionId} — ${parties.length} parties`);

  // ── Process each disconnected party with a recording ──────────────────────
  for (const party of parties) {
    const status = party.status?.code;
    const recordings = party.recordings || [];

    if (status !== 'Disconnected' || recordings.length === 0) continue;

    // Determine caller phone number (the "from" side of the call)
    const callerPhone =
      party.from?.phoneNumber ||
      party.from?.extensionNumber ||
      null;

    const calledPhone =
      party.to?.phoneNumber ||
      party.to?.extensionNumber ||
      null;

    const direction = party.direction || 'Unknown'; // Inbound | Outbound
    const durationSeconds = party.endTime && party.startTime
      ? Math.round((new Date(party.endTime) - new Date(party.startTime)) / 1000)
      : null;

    console.log(
      `[webhook] Processing ${direction} call — from: ${callerPhone}, to: ${calledPhone}, ` +
      `duration: ${durationSeconds ?? '?'}s, recordings: ${recordings.length}`
    );

    for (const rec of recordings) {
      const recordingId = rec.id;
      if (!recordingId) continue;

      // Run the pipeline asynchronously (don't block the response)
      processRecording({
        recordingId,
        callerPhone,
        calledPhone,
        direction,
        durationSeconds,
        sessionId,
        party,
      }).catch((err) => {
        console.error(`[webhook] Pipeline failed for recording ${recordingId}:`, err.message);
      });
    }
  }
});

/**
 * Full pipeline: download → transcribe → find/create GHL contact → add note
 */
async function processRecording({
  recordingId,
  callerPhone,
  calledPhone,
  direction,
  durationSeconds,
  sessionId,
}) {
  console.log(`[pipeline] Starting for recording ${recordingId}`);

  // 1. Download the recording
  const { buffer, contentType } = await downloadRecording(recordingId);
  console.log(`[pipeline] Downloaded ${Math.round(buffer.length / 1024)} KB (${contentType})`);

  // 2. Transcribe
  const transcript = await transcribe(buffer, contentType);

  // 3. Find or create GHL contact
  // For inbound calls the caller is the person we want to tag in GHL
  const phoneForLookup = direction === 'Inbound' ? callerPhone : calledPhone;

  if (!phoneForLookup) {
    console.warn('[pipeline] No phone number available, skipping GHL update');
    return;
  }

  const contact = await findOrCreateContact(phoneForLookup);

  // 4. Build the note body
  const callDate = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
  const durationStr = durationSeconds != null
    ? `${Math.floor(durationSeconds / 60)}m ${durationSeconds % 60}s`
    : 'unknown';

  const noteBody = [
    `📞 Call Transcript — ${direction} Call`,
    `Date: ${callDate}`,
    `From: ${callerPhone || 'unknown'}`,
    `To:   ${calledPhone || 'unknown'}`,
    `Duration: ${durationStr}`,
    `Session ID: ${sessionId}`,
    `Recording ID: ${recordingId}`,
    ``,
    `─── Transcript ───`,
    transcript || '(no speech detected)',
  ].join('\n');

  // 5. Add note to GHL contact
  await addNote(contact.id, noteBody);

  console.log(`[pipeline] Done — note added to GHL contact ${contact.id}`);
}

module.exports = router;
