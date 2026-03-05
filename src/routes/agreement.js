'use strict';

const { Router } = require('express');
const { z }      = require('zod');
const { upsertContact, addContactNote }          = require('../services/ghlContacts');
const { createCustomer, addCustomerUser, createInvoice,
        getInvoicePaymentLink }                   = require('../services/alternativePayments');
const { config }                                  = require('../config');
const { agreementLimiter }                        = require('../middleware/rateLimit');

const router = Router();

// ─── Validation schema ────────────────────────────────────────────────────────
// .strict() rejects any extra keys not listed here (prevents parameter pollution).
const agreementSchema = z.object({
  first_name:         z.string().min(1).max(100).trim(),
  last_name:          z.string().max(100).trim().optional(),
  // Phone: digits, spaces, +, -, (), .  — 7-20 chars after trimming.
  phone:              z.string().trim().min(7).max(20)
                       .regex(/^[\d\s\+\-\(\)\.]+$/, 'Invalid phone format'),
  email:              z.string().trim().email('Invalid email address').max(254)
                       .transform(v => v.toLowerCase()),
  today_date:         z.string().min(1).max(50),
  agree_collections:  z.union([z.boolean(), z.string()]).optional(),
  agree_no_guarantee: z.union([z.boolean(), z.string()]),
  agree_payment:      z.union([z.boolean(), z.string()]),
  // signature_data: base64 data URL. Min 100 chars (empty canvas), max 200 KB.
  signature_data:     z.string().min(100).max(200_000)
                       .refine(v => v.startsWith('data:image/'), {
                         message: 'signature_data must be an image data URL',
                       }),
}).strict();

// Allowed domains for the AP-returned payment URL (open-redirect guard).
const ALLOWED_PAYMENT_DOMAINS = ['alternativepayments.io'];

/**
 * POST /api/agreement
 *
 * 1. Validate + sanitise request body.
 * 2. Upsert GHL contact + attach a note with agreement details.
 * 3. Create AP customer + invoice (due today).
 * 4. Fetch the hosted AP payment link.
 * 5. Return { ok: true, paymentUrl } — browser redirects to AP.
 */
router.post('/', agreementLimiter, async (req, res) => {
  // ── Input validation ──────────────────────────────────────────────────────
  const parsed = agreementSchema.safeParse(req.body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return res.status(400).json({ ok: false, error: first.message });
  }

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
  } = parsed.data;

  // ── Business-rule checks ──────────────────────────────────────────────────
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

  // ── 1. GHL: upsert contact ────────────────────────────────────────────────
  const contact = await upsertContact({
    firstName: first_name,
    lastName:  last_name || undefined,
    email,
    phone,
  }).catch(() => null);

  // ── 2. GHL: attach agreement note ────────────────────────────────────────
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
      `Digital Signature : Provided (${Math.round(signature_data.length * 0.75 / 1024)} KB)`,
      `Client IP         : ${req.ip}`,
      `Timestamp (UTC)   : ${new Date().toISOString()}`,
    ];
    addContactNote(contact.id, noteLines.join('\n')).catch(() => {});
  }

  // ── 3. AP: create customer ────────────────────────────────────────────────
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

  // ── 3b. AP: add customer user (fire-and-forget) ───────────────────────────
  addCustomerUser(customer.id, {
    email,
    first_name,
    last_name: last_name || first_name,
  }).catch((err) => console.warn('[agreement] addCustomerUser failed (non-fatal):', err.message));

  // ── 4. AP: create invoice (due today) ─────────────────────────────────────
  let invoice;
  try {
    const today = new Date().toISOString().split('T')[0];
    invoice = await createInvoice({
      customer_id: customer.id,
      due_date:    today,
      line_items:  [{
        description: config.payment.invoiceDescription,
        amount:      config.payment.presetAmount / 100,
        quantity:    1,
      }],
    });
  } catch (err) {
    return res.status(502).json({ ok: false, error: `Invoice creation failed: ${err.message}` });
  }

  // ── 5. AP: get hosted payment link ────────────────────────────────────────
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

  // Ensure absolute URL.
  if (!paymentUrl.startsWith('http')) {
    paymentUrl = `https://${paymentUrl}`;
  }

  // ── Open-redirect guard ───────────────────────────────────────────────────
  // paymentUrl comes from the AP API, not from user input, but we validate
  // its domain anyway to defend against a compromised upstream response.
  try {
    const parsed = new URL(paymentUrl);
    if (!ALLOWED_PAYMENT_DOMAINS.some(d => parsed.hostname === d || parsed.hostname.endsWith('.' + d))) {
      console.error('[agreement] payment URL failed domain allowlist:', parsed.hostname);
      return res.status(502).json({ ok: false, error: 'Payment URL failed domain validation.' });
    }
  } catch {
    return res.status(502).json({ ok: false, error: 'Payment URL is not a valid URL.' });
  }

  return res.json({ ok: true, paymentUrl });
});

module.exports = router;
