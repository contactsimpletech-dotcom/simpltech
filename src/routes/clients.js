'use strict';

const { Router } = require('express');
const {
  createClientWithPresetPayment,
  createCustomer,
  getCustomer,
  listCustomers,
  listTransactions,
} = require('../services/alternativePayments');

const router = Router();

/**
 * POST /api/clients
 *
 * Create a new customer in Alternative Payments **and** attach a payment
 * request with the preset amount (or an optional override amount).
 *
 * Body:
 *   {
 *     name        : string  (required)  — customer display name
 *     email       : string  (required)  — customer e-mail address
 *     phone       : string  (optional)  — E.164 format preferred
 *     address     : object  (optional)  — { line1, city, state, postalCode, country }
 *     description : string  (optional)  — payment description
 *     redirectUrl : string  (optional)  — URL to redirect after payment
 *     amount      : number  (optional)  — override amount in cents
 *     currency    : string  (optional)  — ISO 4217, e.g. "USD"
 *     metadata    : object  (optional)  — arbitrary key-value pairs
 *   }
 *
 * Response 201:
 *   {
 *     ok: true,
 *     customer: { ... },
 *     paymentRequest: { id, url, amount, currency, status, ... },
 *     checkoutUrl: string  — convenience alias for paymentRequest.url
 *   }
 */
router.post('/', async (req, res) => {
  const { name, email, phone, address, description, redirectUrl, amount, currency, metadata } =
    req.body;

  if (!name || !email) {
    return res.status(400).json({ ok: false, error: '`name` and `email` are required.' });
  }

  try {
    const result = await createClientWithPresetPayment({
      name,
      email,
      phone,
      address,
      description,
      redirectUrl,
      amount,
      currency,
      metadata,
    });

    return res.status(201).json({
      ok: true,
      customer: result.customer,
      paymentRequest: result.paymentRequest,
      checkoutUrl: result.paymentRequest.url ?? result.paymentRequest.checkoutUrl ?? null,
    });
  } catch (err) {
    return res.status(502).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/clients
 *
 * List customers with optional cursor-based pagination.
 * Query params: after, before, limit
 */
router.get('/', async (req, res) => {
  const { after, before, limit } = req.query;
  try {
    const data = await listCustomers({ after, before, limit: limit ? parseInt(limit, 10) : undefined });
    res.json({ ok: true, ...data });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/clients/:id
 *
 * Fetch a single customer by ID.
 */
router.get('/:id', async (req, res) => {
  try {
    const customer = await getCustomer(req.params.id);
    res.json({ ok: true, customer });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/clients/:id/transactions
 *
 * List transactions for a specific customer.
 */
router.get('/:id/transactions', async (req, res) => {
  try {
    const data = await listTransactions({ customerId: req.params.id });
    res.json({ ok: true, ...data });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

module.exports = router;
