'use strict';

const { Router } = require('express');
const { upsertContact, addContactNote } = require('../services/ghlContacts');

const router = Router();

/**
 * POST /api/agreement
 *
 * Receives the IT Support Authorization & Payment Agreement form submission.
 * Validates required fields, upserts the contact in GHL, and attaches a note
 * with the agreement details.
 *
 * Body (JSON):
 *   first_name          — required
 *   last_name           — optional
 *   phone               — required
 *   email               — required
 *   today_date          — required
 *   agree_collections   — boolean (section 6)
 *   agree_no_guarantee  — boolean, required (section 10)
 *   agree_payment       — boolean, required (section 14)
 *   signature_data      — base64 PNG data URL, required
 *
 * Success: 200 { ok: true }
 * Error:   400 { ok: false, error }
 */
router.post('/', async (req, res) => {
  const {
    first_name,
    last_name,
    phone,
    email,
    today_date,
    agree_collections,
    agree_no_guarantee,
    agree_payment,
    signature_data,
  } = req.body;

  if (!first_name || !phone || !email || !today_date) {
    return res.status(400).json({
      ok: false,
      error: 'First name, phone, email, and today\'s date are required.',
    });
  }

  if (!agree_no_guarantee) {
    return res.status(400).json({
      ok: false,
      error: 'You must acknowledge Section 10 (No Guarantee of Results).',
    });
  }

  if (!agree_payment) {
    return res.status(400).json({
      ok: false,
      error: 'You must agree to Section 14 (Payment).',
    });
  }

  if (!signature_data || signature_data.length < 100) {
    return res.status(400).json({
      ok: false,
      error: 'A drawn signature is required.',
    });
  }

  // Upsert contact — fire-and-forget on error so submission always succeeds
  const contact = await upsertContact({
    firstName: first_name,
    lastName:  last_name || undefined,
    email,
    phone,
  }).catch(() => null);

  if (contact?.id) {
    const noteLines = [
      'IT Support Authorization & Payment Agreement',
      '─'.repeat(48),
      `Signed Date : ${today_date}`,
      `Name        : ${first_name}${last_name ? ' ' + last_name : ''}`,
      `Phone       : ${phone}`,
      `Email       : ${email}`,
      '',
      `Sec  6 – Collections & Attorney Fees : ${agree_collections ? 'Agreed' : 'Not checked'}`,
      `Sec 10 – No Guarantee of Results     : Agreed`,
      `Sec 14 – Payment Agreement           : Agreed`,
      '',
      `Digital Signature : Provided`,
      `Client IP         : ${req.ip}`,
      `Timestamp (UTC)   : ${new Date().toISOString()}`,
    ];

    addContactNote(contact.id, noteLines.join('\n')).catch(() => {});
  }

  return res.json({ ok: true });
});

module.exports = router;
