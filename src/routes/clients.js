'use strict';

const { Router } = require('express');
const {
  createClientWithInvoice,
  getCustomer,
  listCustomers,
  archiveCustomer,
  listCustomerUsers,
  addCustomerUser,
  listTransactions,
} = require('../services/alternativePayments');
const { createQBOClientWithInvoice } = require('../services/quickbooks');
const { qboEnabled, config }         = require('../config');

const router = Router();

/**
 * POST /api/clients
 *
 * Called when a client submits the intake form.
 *
 * What happens:
 *   1. Creates an Alternative Payments customer from the form fields.
 *   2. Creates a $75 invoice (one line item) for that customer.
 *   3. Fetches the hosted invoice payment link.
 *   4. Redirects the client's browser to the invoice checkout page (302).
 *      If called from a server / API client (not a browser form), pass
 *      ?redirect=false to receive JSON instead.
 *
 * Form field names (GHL form builder query keys):
 *   first_name   — required
 *   last_name    — optional
 *   email        — required
 *   phone        — optional (stored for reference)
 *
 * Optional overrides:
 *   amount           — invoice total in cents (default: PRESET_AMOUNT = 7500)
 *   currency         — ISO 4217 (default: PRESET_CURRENCY = USD)
 *   line_description — line-item label on the invoice (default: INVOICE_DESCRIPTION)
 *   due_days         — days until invoice due date (default: 30)
 *   external_id      — your own reference ID stored on the AP customer record
 *
 * Success responses:
 *   302  Location: https://checkout.alternativepayments.io/pay/inv_xxx   (default)
 *   201  JSON { ok, customer, invoice, checkoutUrl }                     (?redirect=false)
 *
 * Error response:
 *   502  JSON { ok: false, error: "…" }
 */
router.post('/', async (req, res) => {
  const firstName      = req.body.first_name      ?? req.body.firstName;
  const lastName       = req.body.last_name       ?? req.body.lastName;
  const lineDesc       = req.body.line_description ?? req.body.lineDescription;
  const externalId     = req.body.external_id     ?? req.body.externalId;
  const { email, amount, currency, due_days } = req.body;

  // redirect=true by default — only skip if caller explicitly passes redirect=false
  const doRedirect = req.query.redirect !== 'false';

  if (!firstName || !email) {
    return res.status(400).json({
      ok: false,
      error: '`first_name` and `email` are required.',
    });
  }

  const amountCents = amount ? parseInt(amount, 10) : config.payment.presetAmount;
  const currency_   = currency ?? config.payment.currency;
  const dueDays     = due_days ? parseInt(due_days, 10) : 30;
  const lineDescFinal = lineDesc ?? config.payment.invoiceDescription;

  // ── Step 1: QuickBooks (if configured) ─────────────────────────────────────
  let qboCustomer = null;
  let qboInvoice  = null;

  if (qboEnabled()) {
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
  }

  // ── Step 2: Alternative Payments ───────────────────────────────────────────
  let result;
  try {
    result = await createClientWithInvoice({
      first_name:       firstName,
      last_name:        lastName,
      email,
      amount:           amountCents,
      currency:         currency_,
      line_description: lineDescFinal,
      due_days:         dueDays,
      external_id:      externalId ?? qboCustomer?.Id,
    });
  } catch (err) {
    return res.status(502).json({ ok: false, error: err.message });
  }

  const { customer, invoice, checkoutUrl } = result;

  // ── Redirect the browser to the invoice checkout page ──────────────────────
  if (doRedirect && checkoutUrl) {
    return res.redirect(302, checkoutUrl);
  }

  // ── JSON response (API / server-side callers) ───────────────────────────────
  return res.status(201).json({
    ok: true,
    ...(qboCustomer && { qboCustomer, qboInvoice }),
    customer,
    invoice,
    checkoutUrl,
  });
});

// ─── Other customer routes ────────────────────────────────────────────────────

/** GET /api/clients — list customers */
router.get('/', async (req, res) => {
  const { limit, after, company_name } = req.query;
  try {
    const data = await listCustomers({
      ...(limit && { limit: parseInt(limit, 10) }),
      ...(after && { after }),
      ...(company_name && { company_name }),
    });
    res.json({ ok: true, ...data });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

/** GET /api/clients/:id */
router.get('/:id', async (req, res) => {
  try {
    const customer = await getCustomer(req.params.id);
    res.json({ ok: true, customer });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

/** DELETE /api/clients/:id — archive */
router.delete('/:id', async (req, res) => {
  try {
    await archiveCustomer(req.params.id);
    res.json({ ok: true, message: `Customer ${req.params.id} archived.` });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

/** GET /api/clients/:id/users */
router.get('/:id/users', async (req, res) => {
  try {
    const users = await listCustomerUsers(req.params.id);
    res.json({ ok: true, users });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

/** POST /api/clients/:id/users — body: { email, first_name, last_name } */
router.post('/:id/users', async (req, res) => {
  const { email, first_name, last_name } = req.body;
  if (!email || !first_name || !last_name) {
    return res.status(400).json({
      ok: false,
      error: '`email`, `first_name`, and `last_name` are required.',
    });
  }
  try {
    const user = await addCustomerUser(req.params.id, { email, first_name, last_name });
    res.status(201).json({ ok: true, user });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

/** GET /api/clients/:id/transactions */
router.get('/:id/transactions', async (req, res) => {
  try {
    const data = await listTransactions({ customer_id: req.params.id });
    res.json({ ok: true, ...data });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

module.exports = router;
