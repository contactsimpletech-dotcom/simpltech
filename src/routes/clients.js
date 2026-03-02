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
 * Create a new customer in GHL **and** attach a payment request with the
 * preset amount (or an optional override).
 *
 * Field names mirror the GoHighLevel form builder query keys:
 *
 *   Body:
 *   {
 *     first_name  : string  (required)  — maps to GHL firstName
 *     last_name   : string  (required)  — maps to GHL lastName
 *     email       : string  (required)
 *     phone       : string  (optional)  — E.164 preferred, e.g. "+15550001234"
 *     description : string  (optional)  — payment description shown on checkout
 *     redirectUrl : string  (optional)  — URL to redirect after payment
 *     amount      : number  (optional)  — override preset amount, in cents
 *     currency    : string  (optional)  — ISO 4217, defaults to PRESET_CURRENCY
 *     locationId  : string  (optional)  — GHL location/sub-account ID
 *     metadata    : object  (optional)  — arbitrary key-value pairs
 *   }
 *
 * Response 201:
 *   {
 *     ok: true,
 *     customer: { id, firstName, lastName, email, … },
 *     paymentRequest: { id, url, amount, currency, status, … },
 *     checkoutUrl: string  — share this with the client to collect payment
 *   }
 */
router.post('/', async (req, res) => {
  // Accept both snake_case (form builder query keys) and camelCase.
  const firstName = req.body.first_name ?? req.body.firstName;
  const lastName  = req.body.last_name  ?? req.body.lastName;
  const { email, phone, description, redirectUrl, amount, currency, locationId, metadata } =
    req.body;

  if (!firstName || !email) {
    return res.status(400).json({
      ok: false,
      error: '`first_name` (or `firstName`) and `email` are required.',
    });
  }

  try {
    const result = await createClientWithPresetPayment({
      firstName,
      lastName: lastName ?? '',
      email,
      phone,
      description,
      redirectUrl,
      amount,
      currency,
      locationId,
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
