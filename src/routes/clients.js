'use strict';

const { Router } = require('express');
const {
  createClientWithPresetPayment,
  getCustomer,
  listCustomers,
  archiveCustomer,
  listCustomerUsers,
  addCustomerUser,
  listTransactions,
} = require('../services/alternativePayments');

const router = Router();

/**
 * POST /api/clients
 *
 * Create an Alternative Payments customer and immediately attach a payment
 * request for the preset amount (or an overridden amount).
 *
 * Body — accepts both GoHighLevel form query keys (snake_case) and camelCase:
 *   {
 *     first_name   : string  (required)
 *     last_name    : string  (optional)
 *     email        : string  (required)
 *     redirect_url : string  (optional) — where to send payer after checkout
 *     reference_id : string  (optional) — your internal reference
 *     external_id  : string  (optional) — e.g. GHL contact ID
 *     amount       : number  (optional) — override in cents
 *     currency     : string  (optional) — ISO 4217, default PRESET_CURRENCY
 *   }
 *
 * Response 201:
 *   {
 *     ok: true,
 *     customer:       { id, name, email, external_id, created_at }
 *     paymentRequest: { id, url, status }
 *     checkoutUrl:    string  — share with the client to collect payment
 *   }
 */
router.post('/', async (req, res) => {
  const firstName   = req.body.first_name  ?? req.body.firstName;
  const lastName    = req.body.last_name   ?? req.body.lastName;
  const redirectUrl = req.body.redirect_url ?? req.body.redirectUrl;
  const referenceId = req.body.reference_id ?? req.body.referenceId;
  const externalId  = req.body.external_id  ?? req.body.externalId;
  const { email, amount, currency } = req.body;

  if (!firstName || !email) {
    return res.status(400).json({
      ok: false,
      error: '`first_name` and `email` are required.',
    });
  }

  try {
    const result = await createClientWithPresetPayment({
      first_name: firstName,
      last_name: lastName,
      email,
      amount,
      currency,
      redirect_url: redirectUrl,
      reference_id: referenceId,
      external_id: externalId,
    });

    return res.status(201).json({
      ok: true,
      customer: result.customer,
      paymentRequest: result.paymentRequest,
      checkoutUrl: result.checkoutUrl,
    });
  } catch (err) {
    return res.status(502).json({ ok: false, error: err.message });
  }
});

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

/** GET /api/clients/:id — retrieve one customer */
router.get('/:id', async (req, res) => {
  try {
    const customer = await getCustomer(req.params.id);
    res.json({ ok: true, customer });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

/** DELETE /api/clients/:id — archive a customer */
router.delete('/:id', async (req, res) => {
  try {
    await archiveCustomer(req.params.id);
    res.json({ ok: true, message: `Customer ${req.params.id} archived.` });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

/** GET /api/clients/:id/users — list customer users */
router.get('/:id/users', async (req, res) => {
  try {
    const users = await listCustomerUsers(req.params.id);
    res.json({ ok: true, users });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/clients/:id/users — add a user to a customer
 * Body: { email, first_name, last_name }
 */
router.post('/:id/users', async (req, res) => {
  const { email, first_name, last_name } = req.body;
  if (!email || !first_name || !last_name) {
    return res.status(400).json({ ok: false, error: '`email`, `first_name`, and `last_name` are required.' });
  }
  try {
    const user = await addCustomerUser(req.params.id, { email, first_name, last_name });
    res.status(201).json({ ok: true, user });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

/** GET /api/clients/:id/transactions — list a customer's transactions */
router.get('/:id/transactions', async (req, res) => {
  try {
    const data = await listTransactions({ customer_id: req.params.id });
    res.json({ ok: true, ...data });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

module.exports = router;
