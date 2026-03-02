'use strict';

const { getAuthenticatedClient, invalidateToken } = require('../auth/ghlAuth');
const { config } = require('../config');

// ─── Base path ────────────────────────────────────────────────────────────────
const BASE = '/alternative-payments';

/**
 * Thin wrapper around axios that:
 *  1. Obtains a fresh authenticated client.
 *  2. On a 401 response, invalidates the cached token and retries once.
 *  3. Normalises errors into plain Error objects with descriptive messages.
 *
 * @param {(client: import('axios').AxiosInstance) => Promise<import('axios').AxiosResponse>} fn
 */
async function withAuth(fn) {
  let client = await getAuthenticatedClient();

  try {
    const res = await fn(client);
    return res.data;
  } catch (err) {
    if (err.response?.status === 401) {
      // Token may have been revoked; clear cache and retry once.
      invalidateToken();
      client = await getAuthenticatedClient();
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
  return new Error(`Alternative Payments API error [${status}]: ${JSON.stringify(detail)}`);
}

// ─── Customers ────────────────────────────────────────────────────────────────

/**
 * Create a new customer (client) in Alternative Payments.
 *
 * @param {{
 *   name: string,
 *   email: string,
 *   phone?: string,
 *   address?: {
 *     line1?: string,
 *     line2?: string,
 *     city?: string,
 *     state?: string,
 *     postalCode?: string,
 *     country?: string
 *   },
 *   metadata?: Record<string, string>
 * }} customerData
 * @returns {Promise<object>} The created customer object.
 */
async function createCustomer(customerData) {
  return withAuth((client) =>
    client.post(`${BASE}/customers`, customerData),
  );
}

/**
 * Fetch a customer by ID.
 *
 * @param {string} customerId
 * @returns {Promise<object>}
 */
async function getCustomer(customerId) {
  return withAuth((client) =>
    client.get(`${BASE}/customers/${customerId}`),
  );
}

/**
 * List customers with optional cursor-based pagination.
 *
 * @param {{ after?: string, before?: string, limit?: number }} [pagination]
 * @returns {Promise<object>}
 */
async function listCustomers(pagination = {}) {
  return withAuth((client) =>
    client.get(`${BASE}/customers`, { params: pagination }),
  );
}

// ─── Payment Requests ─────────────────────────────────────────────────────────

/**
 * Create a one-off payment request (checkout link) for a customer.
 *
 * @param {{
 *   customerId: string,
 *   amount?: number,    // Amount in cents. Falls back to config.payment.presetAmount.
 *   currency?: string,  // ISO 4217. Falls back to config.payment.currency.
 *   description?: string,
 *   redirectUrl?: string,
 *   metadata?: Record<string, string>
 * }} paymentData
 * @returns {Promise<object>} Payment request object including a hosted checkout URL.
 */
async function createPaymentRequest(paymentData) {
  const body = {
    customerId: paymentData.customerId,
    amount: paymentData.amount ?? config.payment.presetAmount,
    currency: paymentData.currency ?? config.payment.currency,
    description: paymentData.description ?? 'Payment request',
    ...(paymentData.redirectUrl && { redirectUrl: paymentData.redirectUrl }),
    ...(paymentData.metadata && { metadata: paymentData.metadata }),
  };

  return withAuth((client) =>
    client.post(`${BASE}/payment-requests`, body),
  );
}

/**
 * High-level helper: create a customer **and** immediately attach a payment
 * request with the preset amount.
 *
 * Returns both the customer and the payment request so callers can redirect
 * the end-user to paymentRequest.url.
 *
 * @param {{
 *   name: string,
 *   email: string,
 *   phone?: string,
 *   address?: object,
 *   description?: string,
 *   redirectUrl?: string,
 *   amount?: number,
 *   currency?: string,
 *   metadata?: Record<string, string>
 * }} opts
 * @returns {Promise<{ customer: object, paymentRequest: object }>}
 */
async function createClientWithPresetPayment(opts) {
  const customer = await createCustomer({
    name: opts.name,
    email: opts.email,
    ...(opts.phone && { phone: opts.phone }),
    ...(opts.address && { address: opts.address }),
    ...(opts.metadata && { metadata: opts.metadata }),
  });

  const paymentRequest = await createPaymentRequest({
    customerId: customer.id,
    amount: opts.amount,      // undefined → preset from env
    currency: opts.currency,  // undefined → preset from env
    description: opts.description,
    redirectUrl: opts.redirectUrl,
    metadata: opts.metadata,
  });

  return { customer, paymentRequest };
}

// ─── Transactions ─────────────────────────────────────────────────────────────

/**
 * List transactions with optional filters.
 *
 * @param {{
 *   customerId?: string,
 *   status?: string,
 *   type?: string,
 *   after?: string,
 *   before?: string,
 *   limit?: number
 * }} [filters]
 * @returns {Promise<object>}
 */
async function listTransactions(filters = {}) {
  return withAuth((client) =>
    client.get(`${BASE}/transactions`, { params: filters }),
  );
}

module.exports = {
  createCustomer,
  getCustomer,
  listCustomers,
  createPaymentRequest,
  createClientWithPresetPayment,
  listTransactions,
};
