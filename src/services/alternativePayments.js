'use strict';

const { getAPClient, invalidateAPToken } = require('../auth/apAuth');
const { config } = require('../config');

/**
 * Execute a request against the AP API.
 * On a 401, the cached token is invalidated and the request retried once.
 *
 * @param {(client: import('axios').AxiosInstance) => Promise<import('axios').AxiosResponse>} fn
 */
async function withAuth(fn) {
  let client = await getAPClient();
  try {
    const res = await fn(client);
    return res.data;
  } catch (err) {
    if (err.response?.status === 401) {
      invalidateAPToken();
      client = await getAPClient();
      try {
        const res = await fn(client);
        return res.data;
      } catch (retryErr) {
        throw normaliseError(retryErr);
      }
    }
    throw normaliseError(err);
  }
}

function normaliseError(err) {
  const detail = err.response?.data ?? err.message;
  const status = err.response?.status ?? 'N/A';
  return new Error(`Alternative Payments API [${status}]: ${JSON.stringify(detail)}`);
}

// ─── Customers ────────────────────────────────────────────────────────────────

/**
 * Create a customer.
 * AP API: POST /customers
 *
 * @param {{
 *   name        : string,   // required — full name or company name
 *   email       : string,   // required
 *   external_id?: string    // your internal reference (e.g. GHL contact ID)
 * }} data
 */
async function createCustomer(data) {
  return withAuth((c) => c.post('/customers', {
    name: data.name,
    email: data.email,
    ...(data.external_id && { external_id: data.external_id }),
  }));
}

/**
 * Retrieve a customer by ID.
 * AP API: GET /customers/{id}
 */
async function getCustomer(id) {
  return withAuth((c) => c.get(`/customers/${id}`));
}

/**
 * List customers with optional pagination / filters.
 * AP API: GET /customers
 *
 * @param {{ limit?: number, after?: string, company_name?: string }} [params]
 */
async function listCustomers(params = {}) {
  return withAuth((c) => c.get('/customers', { params }));
}

/**
 * Archive (soft-delete) a customer.
 * AP API: DELETE /customers/{id}
 */
async function archiveCustomer(id) {
  return withAuth((c) => c.delete(`/customers/${id}`));
}

/**
 * List users belonging to a customer.
 * AP API: GET /customers/{id}/users
 */
async function listCustomerUsers(customerId) {
  return withAuth((c) => c.get(`/customers/${customerId}/users`));
}

/**
 * Add a user to a customer.
 * AP API: POST /customers/{id}/users
 *
 * @param {string} customerId
 * @param {{ email: string, first_name: string, last_name: string }} user
 */
async function addCustomerUser(customerId, user) {
  return withAuth((c) => c.post(`/customers/${customerId}/users`, user));
}

// ─── Payment Requests ─────────────────────────────────────────────────────────

/**
 * Create a one-off payment request (hosted checkout link).
 * AP API: POST /payments/request
 *
 * @param {{
 *   amount      : number,   // cents (e.g. 5000 = $50.00)
 *   currency    : string,   // ISO 4217 e.g. "USD"
 *   redirect_url: string,   // where to send the payer after checkout
 *   reference_id?: string   // your internal reference ID
 * }} data
 */
async function createPaymentRequest(data) {
  return withAuth((c) => c.post('/payments/request', {
    amount: String(data.amount ?? config.payment.presetAmount),
    currency: data.currency ?? config.payment.currency,
    redirect_url: data.redirect_url ?? '',
    ...(data.reference_id && { reference_id: data.reference_id }),
  }));
}

/**
 * Retrieve the current status of a payment request.
 * AP API: GET /payments/request/{id}
 */
async function getPaymentRequest(id) {
  return withAuth((c) => c.get(`/payments/request/${id}`));
}

// ─── Invoices ─────────────────────────────────────────────────────────────────

/**
 * Create an invoice with line items.
 * AP API: POST /invoices
 *
 * @param {{
 *   customer_id : string,
 *   currency    : string,
 *   due_date    : string,   // ISO date e.g. "2025-09-01"
 *   line_items  : Array<{ description: string, amount: number, quantity: number }>
 * }} data
 */
async function createInvoice(data) {
  return withAuth((c) => c.post('/invoices', data));
}

/**
 * Get the hosted payment link for an invoice.
 * AP API: GET /invoices/{id}/payment-link
 */
async function getInvoicePaymentLink(invoiceId) {
  return withAuth((c) => c.get(`/invoices/${invoiceId}/payment-link`));
}

/**
 * Get a signed PDF download URL for an invoice.
 * AP API: GET /invoices/{id}/pdf-link
 */
async function getInvoicePdfLink(invoiceId) {
  return withAuth((c) => c.get(`/invoices/${invoiceId}/pdf-link`));
}

// ─── Transactions ─────────────────────────────────────────────────────────────

/**
 * List transactions.
 * AP API: GET /payments
 *
 * @param {{
 *   status?        : string,
 *   type?          : string,
 *   payment_method?: string,
 *   invoice_id?    : string,
 *   customer_id?   : string
 * }} [filters]
 */
async function listTransactions(filters = {}) {
  return withAuth((c) => c.get('/payments', { params: filters }));
}

// ─── Payouts ──────────────────────────────────────────────────────────────────

/** List all payouts. AP API: GET /payouts */
async function listPayouts(params = {}) {
  return withAuth((c) => c.get('/payouts', { params }));
}

/** Get a single payout. AP API: GET /payouts/{id} */
async function getPayout(id) {
  return withAuth((c) => c.get(`/payouts/${id}`));
}

/** Get transactions rolled into a payout. AP API: GET /payouts/{id}/transactions */
async function getPayoutTransactions(id) {
  return withAuth((c) => c.get(`/payouts/${id}/transactions`));
}

// ─── High-level helper ────────────────────────────────────────────────────────

/**
 * Create an AP customer and immediately issue a payment request at the
 * preset amount.
 *
 * Input field names mirror the GoHighLevel form builder query keys:
 *   first_name, last_name, email, phone
 *
 * @param {{
 *   first_name   : string,
 *   last_name?   : string,
 *   email        : string,
 *   amount?      : number,     // cents override; falls back to PRESET_AMOUNT
 *   currency?    : string,
 *   redirect_url?: string,
 *   reference_id?: string,
 *   external_id? : string      // e.g. GHL contact ID for cross-referencing
 * }} opts
 * @returns {Promise<{ customer: object, paymentRequest: object, checkoutUrl: string }>}
 */
async function createClientWithPresetPayment(opts) {
  const fullName = [opts.first_name, opts.last_name].filter(Boolean).join(' ');

  const customer = await createCustomer({
    name: fullName,
    email: opts.email,
    external_id: opts.external_id,
  });

  const paymentRequest = await createPaymentRequest({
    amount: opts.amount,
    currency: opts.currency,
    redirect_url: opts.redirect_url ?? '',
    reference_id: opts.reference_id ?? customer.id,
  });

  const checkoutUrl = paymentRequest.url ?? null;

  return { customer, paymentRequest, checkoutUrl };
}

module.exports = {
  // Customers
  createCustomer,
  getCustomer,
  listCustomers,
  archiveCustomer,
  listCustomerUsers,
  addCustomerUser,
  // Payment Requests
  createPaymentRequest,
  getPaymentRequest,
  // Invoices
  createInvoice,
  getInvoicePaymentLink,
  getInvoicePdfLink,
  // Transactions
  listTransactions,
  // Payouts
  listPayouts,
  getPayout,
  getPayoutTransactions,
  // High-level
  createClientWithPresetPayment,
};
