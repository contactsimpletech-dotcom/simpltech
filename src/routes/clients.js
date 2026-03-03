'use strict';

const { Router } = require('express');
const { createClientWithInvoice } = require('../services/alternativePayments');
const { config }                   = require('../config');

const router = Router();

/**
 * POST /api/clients
 *
 * Called when a client submits the intake form.
 *
 * What happens:
 *   1. Creates an Alternative Payments customer + invoice.
 *   2. Redirects the client's browser to the AP hosted payment page (302).
 *      If called from a server / API client (not a browser form), pass
 *      ?redirect=false to receive JSON instead.
 *
 * Form field names (GHL form builder query keys):
 *   first_name   — required
 *   last_name    — optional
 *   email        — required
 *   phone        — optional
 *
 * Optional overrides:
 *   amount           — invoice total in cents (default: PRESET_AMOUNT = 7500)
 *   currency         — ISO 4217 (default: PRESET_CURRENCY = USD)
 *   line_description — line-item label on the invoice (default: INVOICE_DESCRIPTION)
 *   due_days         — days until invoice due date (default: 30)
 *
 * Success responses:
 *   302  Location: https://…alternativepayments.io/…  (default)
 *   201  JSON { ok, customer, invoice, checkoutUrl }  (?redirect=false)
 *
 * Error response:
 *   502  JSON { ok: false, error: "…" }
 */

/**
 * GET /api/clients?first_name=…&email=…
 *
 * Same as POST but reads fields from query string.
 * Used when GHL redirects here after form submission using merge tags:
 *   ?first_name={{contact.first_name}}&last_name={{contact.last_name}}
 *   &email={{contact.email}}&phone={{contact.phone}}
 */
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

  const doRedirect = req.query.redirect !== 'false';

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

  // ── Create Alternative Payments customer + invoice ───────────────────────────
  let customer, invoice, checkoutUrl;
  try {
    ({ customer, invoice, checkoutUrl } = await createClientWithInvoice({
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

  if (!checkoutUrl) {
    return res.status(502).json({
      ok: false,
      error: 'Alternative Payments did not return a payment link. The invoice was created but no checkout URL was provided.',
      invoice,
    });
  }

  // ── Redirect the browser to the AP hosted payment page ──────────────────────
  if (doRedirect) {
    return res.redirect(302, checkoutUrl);
  }

  // ── JSON response (API / server-side callers) ────────────────────────────────
  return res.status(201).json({
    ok: true,
    customer,
    invoice,
    checkoutUrl,
  });
}

module.exports = router;
