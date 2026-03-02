'use strict';

const { Router } = require('express');
const { createQBOClientWithInvoice } = require('../services/quickbooks');
const { config }                     = require('../config');

const router = Router();

/**
 * POST /api/clients
 *
 * Called when a client submits the intake form.
 *
 * What happens:
 *   1. Creates a QuickBooks customer + invoice.
 *   2. Redirects the client's browser to the QBO invoice payment page (302).
 *      The payment page is provided by QuickBooks Payments (InvoiceLink).
 *      If called from a server / API client (not a browser form), pass
 *      ?redirect=false to receive JSON instead.
 *
 * Requires QuickBooks Payments to be enabled on your QBO account:
 *   QBO → Settings → Payments → Sign up
 *   Without it, InvoiceLink will not be present and the redirect will fail.
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
 *   302  Location: https://app.qbo.intuit.com/app/pay/…   (default)
 *   201  JSON { ok, qboCustomer, qboInvoice, checkoutUrl } (?redirect=false)
 *
 * Error response:
 *   502  JSON { ok: false, error: "…" }
 */
router.post('/', async (req, res) => {
  const firstName     = req.body.first_name       ?? req.body.firstName;
  const lastName      = req.body.last_name        ?? req.body.lastName;
  const lineDesc      = req.body.line_description ?? req.body.lineDescription;
  const { email, amount, currency, due_days } = req.body;

  // redirect=true by default — only skip if caller explicitly passes redirect=false
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

  // ── Create QuickBooks customer + invoice ────────────────────────────────────
  let qboCustomer, qboInvoice;
  try {
    ({ qboCustomer, qboInvoice } = await createQBOClientWithInvoice({
      first_name:       firstName,
      last_name:        lastName,
      email,
      phone:            req.body.phone,
      amount:           amountCents,
      currency:         currency_,
      line_description: lineDescFinal,
      due_days:         dueDays,
    }));
  } catch (err) {
    return res.status(502).json({ ok: false, error: err.message });
  }

  // ── Get QBO Payments checkout URL from the invoice ──────────────────────────
  const checkoutUrl = qboInvoice.InvoiceLink;

  if (!checkoutUrl) {
    return res.status(502).json({
      ok: false,
      error: 'QuickBooks did not return an invoice link. The invoice was created but could not be sent — check that the email address is valid and that the QBO account is active.',
      qboInvoice,
    });
  }

  // ── Redirect the browser to the QBO invoice view page ──────────────────────
  // The page shows the invoice details. If QuickBooks Payments is enabled on
  // the account, a "Pay Now" button will also appear on the page.
  if (doRedirect) {
    return res.redirect(302, checkoutUrl);
  }

  // ── JSON response (API / server-side callers) ───────────────────────────────
  return res.status(201).json({
    ok: true,
    qboCustomer,
    qboInvoice,
    checkoutUrl,
  });
});

module.exports = router;

