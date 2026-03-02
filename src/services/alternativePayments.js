'use strict';

const { getAuthenticatedClient, invalidateToken } = require('../auth/ghlAuth');
const { config } = require('../config');

// ─── Base paths ───────────────────────────────────────────────────────────────
const AP_BASE = '/alternative-payments';   // Alternative Payments endpoints
const CT_BASE = '/contacts';               // GHL Contacts API (customer creation)

/**
 * Thin wrapper that:
 *  1. Obtains an authenticated axios client.
 *  2. On a 401, invalidates the cached token and retries once.
 *  3. Normalises errors into descriptive Error objects.
 */
async function withAuth(fn) {
  let client = await getAuthenticatedClient();
  try {
    const res = await fn(client);
    return res.data;
  } catch (err) {
    if (err.response?.status === 401) {
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
  return new Error(`GHL API error [${status}]: ${JSON.stringify(detail)}`);
}

// ─── Customers / Contacts ─────────────────────────────────────────────────────

/**
 * Create a customer using the GHL Contacts API.
 *
 * Field names mirror the GoHighLevel form builder query keys:
 *   first_name, last_name, email, phone
 *
 * @param {{
 *   firstName : string,
 *   lastName  : string,
 *   email     : string,
 *   phone?    : string,
 *   address1? : string,
 *   city?     : string,
 *   state?    : string,
 *   postalCode?: string,
 *   country?  : string,
 *   tags?     : string[],
 *   customFields?: Array<{ id: string, value: string }>,
 *   locationId?: string
 * }} customerData
 * @returns {Promise<object>} The created contact object.
 */
async function createCustomer(customerData) {
  const body = {
    firstName: customerData.firstName,
    lastName: customerData.lastName,
    email: customerData.email,
    ...(customerData.phone && { phone: customerData.phone }),
    ...(customerData.address1 && { address1: customerData.address1 }),
    ...(customerData.city && { city: customerData.city }),
    ...(customerData.state && { state: customerData.state }),
    ...(customerData.postalCode && { postalCode: customerData.postalCode }),
    ...(customerData.country && { country: customerData.country }),
    ...(customerData.tags && { tags: customerData.tags }),
    ...(customerData.customFields && { customFields: customerData.customFields }),
    // locationId is required by the Contacts API; fall back to env var.
    locationId: customerData.locationId ?? config.ghl.locationId,
  };

  return withAuth((client) => client.post(CT_BASE + '/', body));
}

/**
 * Fetch a contact/customer by ID.
 */
async function getCustomer(customerId) {
  return withAuth((client) => client.get(`${CT_BASE}/${customerId}`));
}

/**
 * List contacts with optional cursor-based pagination.
 */
async function listCustomers(pagination = {}) {
  return withAuth((client) =>
    client.get(CT_BASE + '/', { params: { locationId: config.ghl.locationId, ...pagination } }),
  );
}

// ─── Payment Requests ─────────────────────────────────────────────────────────

/**
 * Create a one-off payment request (hosted checkout link) in Alternative Payments.
 *
 * @param {{
 *   customerId  : string,
 *   amount?     : number,   // cents — falls back to PRESET_AMOUNT env var
 *   currency?   : string,   // ISO 4217 — falls back to PRESET_CURRENCY env var
 *   description?: string,
 *   redirectUrl?: string,
 *   metadata?   : Record<string, string>
 * }} paymentData
 * @returns {Promise<object>} Payment request including a hosted checkout URL.
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

  return withAuth((client) => client.post(`${AP_BASE}/payment-requests`, body));
}

/**
 * Create a customer (using GHL form field names) and immediately attach a
 * preset-amount payment request.
 *
 * Input field names match the GoHighLevel form builder query keys:
 *   first_name → firstName
 *   last_name  → lastName
 *   email      → email
 *   phone      → phone
 *
 * @param {{
 *   firstName   : string,
 *   lastName    : string,
 *   email       : string,
 *   phone?      : string,
 *   description?: string,
 *   redirectUrl?: string,
 *   amount?     : number,
 *   currency?   : string,
 *   locationId? : string,
 *   metadata?   : Record<string, string>
 * }} opts
 * @returns {Promise<{ customer: object, paymentRequest: object }>}
 */
async function createClientWithPresetPayment(opts) {
  const customer = await createCustomer({
    firstName: opts.firstName,
    lastName: opts.lastName,
    email: opts.email,
    phone: opts.phone,
    locationId: opts.locationId,
    ...(opts.metadata && { customFields: opts.metadata }),
  });

  // GHL Contacts API wraps the contact under a `contact` key.
  const contactId = customer.contact?.id ?? customer.id;

  const paymentRequest = await createPaymentRequest({
    customerId: contactId,
    amount: opts.amount,
    currency: opts.currency,
    description: opts.description,
    redirectUrl: opts.redirectUrl,
    metadata: opts.metadata,
  });

  return { customer: customer.contact ?? customer, paymentRequest };
}

// ─── Transactions ─────────────────────────────────────────────────────────────

/**
 * List transactions with optional filters.
 */
async function listTransactions(filters = {}) {
  return withAuth((client) =>
    client.get(`${AP_BASE}/transactions`, { params: filters }),
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
