'use strict';

const { Router } = require('express');
const { upsertContact, addContactNote }          = require('../services/ghlContacts');
const { createCustomer, addCustomerUser, createInvoice,
        getInvoicePaymentLink }                   = require('../services/alternativePayments');
const { config }                                  = require('../config');

const router = Router();

/**
 * POST /api/agreement
 *
 * 1. Validate required fields, checkboxes, and signature.
 * 2. Upsert contact in GHL + attach a note with agreement details.
 * 3. Create an AP customer + invoice.
 * 4. Fetch the hosted AP payment link.
 * 5. Return { ok: true, paymentUrl } — browser redirects physically to AP.
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
 */
router.post('/', async (req, res) => {
  console.log('[agreement] Content-Type:', req.headers['content-type']);
  console.log('[agreement] body keys:', Object.keys(req.body || {}));

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
      error: "First name, phone, email, and today's date are required.",
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

  // ── 1. GHL: upsert contact ─────────────────────────────────────────────────
  const contact = await upsertContact({
    firstName: first_name,
    lastName:  last_name || undefined,
    email,
    phone,
  }).catch(() => null);

  // ── 2. GHL: attach agreement note ─────────────────────────────────────────
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

  // ── 3. AP: create customer ─────────────────────────────────────────────────
  let customer;
  try {
    const fullName = [first_name, last_name].filter(Boolean).join(' ');
    try {
      customer = await createCustomer({
        name:  fullName,
        email,
        ...(contact?.id && { external_id: contact.id }),
      });
    } catch (firstErr) {
      // AP rejects duplicate external_id — retry without it so returning
      // customers can still receive a new invoice.
      const isExtIdConflict = firstErr.message?.includes('external id is already used');
      if (contact?.id && isExtIdConflict) {
        console.warn('[agreement] external_id conflict, retrying without it');
        customer = await createCustomer({ name: fullName, email });
      } else {
        throw firstErr;
      }
    }
  } catch (err) {
    console.error('[agreement] AP createCustomer error:', err.message);
    return res.status(502).json({ ok: false, error: `Payment setup failed: ${err.message}` });
  }

  // ── 3b. AP: add user to customer so they can save card / log in ───────────
  // Fire-and-forget — AP will email them an invitation to create their account.
  addCustomerUser(customer.id, {
    email,
    first_name,
    last_name: last_name || first_name,
  }).catch((err) => console.warn('[agreement] addCustomerUser failed (non-fatal):', err.message));

  // ── 4. AP: create invoice ──────────────────────────────────────────────────
  let invoice;
  try {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 30);
    invoice = await createInvoice({
      customer_id: customer.id,
      due_date:    dueDate.toISOString().split('T')[0],
      line_items:  [{
        description: config.payment.invoiceDescription,
        amount:      config.payment.presetAmount / 100,  // convert cents → dollars for AP
        quantity:    1,
      }],
    });
  } catch (err) {
    return res.status(502).json({ ok: false, error: `Invoice creation failed: ${err.message}` });
  }

  // ── 5. AP: get hosted payment link ─────────────────────────────────────────
  let paymentUrl;
  try {
    const linkData = await getInvoicePaymentLink(invoice.id);
    paymentUrl = linkData?.url ?? linkData?.payment_link ?? linkData?.link ?? null;
  } catch (err) {
    return res.status(502).json({ ok: false, error: `Could not retrieve payment link: ${err.message}` });
  }

  if (!paymentUrl) {
    return res.status(502).json({ ok: false, error: 'Alternative Payments did not return a payment URL.' });
  }

  // AP sometimes returns the URL without a protocol — ensure it's absolute.
  if (paymentUrl && !paymentUrl.startsWith('http')) {
    paymentUrl = `https://${paymentUrl}`;
  }

  return res.json({ ok: true, paymentUrl });
});

module.exports = router;
