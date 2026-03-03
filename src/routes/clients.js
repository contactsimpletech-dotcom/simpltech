'use strict';

const { Router } = require('express');
const { createClientWithInvoice } = require('../services/alternativePayments');
const { upsertContact }           = require('../services/ghlContacts');
const { config }                   = require('../config');

const router = Router();

/**
 * POST /api/clients
 *
 * Called when the intake form submits. Creates an AP customer + invoice,
 * gets a short-lived checkout token, and returns JSON for the frontend
 * AP JS SDK to render the embedded payment flow.
 *
 * Form fields:
 *   first_name   — required
 *   last_name    — optional
 *   email        — required
 *   phone        — optional
 *
 * Optional overrides:
 *   amount           — cents (default: PRESET_AMOUNT)
 *   currency         — ISO 4217 (default: PRESET_CURRENCY)
 *   line_description — invoice line label (default: INVOICE_DESCRIPTION)
 *   due_days         — days until due (default: 30)
 *
 * Success: 201 { ok, invoiceId, customerId, checkoutToken }
 * Error:   400 / 502 { ok: false, error }
 */

// GET /api/clients?first_name=…&email=… — GHL merge-tag redirect support
router.get('/', (req, res, next) => {
  req.body = req.query;
  next();
}, handleClientInvoice);

router.post('/', handleClientInvoice);

async function handleClientInvoice(req, res) {
  const firstName     = req.body.first_name       ?? req.body.firstName;
  const lastName      = req.body.last_name        ?? req.body.lastName;
  const lineDesc      = req.body.line_description ?? req.body.lineDescription;
  const { email, amount, currency, due_days } = req.body;

  if (!firstName || !email) {
    return res.status(400).json({
      ok: false,
      error: '`first_name` and `email` are required.',
    });
  }

  const amountCents   = amount   ? parseInt(amount, 10)   : config.payment.presetAmount;
  const currency_     = currency ?? config.payment.currency;
  const dueDays       = due_days ? parseInt(due_days, 10) : 30;
  const lineDescFinal = lineDesc ?? config.payment.invoiceDescription;

  let customer, invoice, checkoutToken;
  try {
    ({ customer, invoice, checkoutToken } = await createClientWithInvoice({
      first_name:       firstName,
      last_name:        lastName,
      email,
      amount:           amountCents,
      currency:         currency_,
      line_description: lineDescFinal,
      due_days:         dueDays,
    }));
  } catch (err) {
    return res.status(502).json({ ok: false, error: err.message });
  }

  if (!checkoutToken) {
    return res.status(502).json({
      ok: false,
      error: 'Alternative Payments did not return a checkout token.',
      invoiceId: invoice?.id,
    });
  }

  // Fire-and-forget: push contact to GHL — never blocks or fails the payment.
  upsertContact({
    firstName,
    lastName,
    email,
    phone: req.body.phone ?? undefined,
  }).catch(() => {}); // errors already logged inside upsertContact

  return res.status(201).json({
    ok: true,
    invoiceId:     invoice.id,
    customerId:    customer.id,
    checkoutToken,
    environment:   config.ap.environment,
  });
}

module.exports = router;
