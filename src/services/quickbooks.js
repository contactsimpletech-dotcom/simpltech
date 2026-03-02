'use strict';

const { getQBOClient } = require('../auth/qboAuth');
const { config } = require('../config');

function normaliseError(err) {
  const detail = err.response?.data ?? err.message;
  const status = err.response?.status ?? 'N/A';
  return new Error(`QuickBooks API [${status}]: ${JSON.stringify(detail)}`);
}

/**
 * Create a QBO Customer.
 * QBO API: POST /v3/company/{realmId}/customer
 *
 * @param {{
 *   first_name : string,
 *   last_name? : string,
 *   email      : string,
 *   phone?     : string,
 * }} data
 * @returns {Promise<object>} The created Customer object.
 */
async function createQBOCustomer(data) {
  const client = await getQBOClient();
  try {
    const res = await client.post('/customer', {
      GivenName:        data.first_name,
      ...(data.last_name && { FamilyName: data.last_name }),
      PrimaryEmailAddr: { Address: data.email },
      ...(data.phone && { PrimaryPhone: { FreeFormNumber: data.phone } }),
    });
    return res.data.Customer;
  } catch (err) {
    throw normaliseError(err);
  }
}

/**
 * Create a QBO Invoice for an existing customer.
 * QBO API: POST /v3/company/{realmId}/invoice
 *
 * amount is in cents (e.g. 7500 = $75.00).
 *
 * The line item references QBO_SERVICE_ITEM_ID (defaults to "1").
 * If your account uses a different service item, set that env var.
 *
 * @param {{
 *   customerId  : string | number,
 *   amount      : number,   // cents
 *   currency    : string,
 *   description : string,
 *   email       : string,
 *   dueDate     : string,   // "YYYY-MM-DD"
 * }} data
 * @returns {Promise<object>} The created Invoice object.
 */
async function createQBOInvoice(data) {
  const client       = await getQBOClient();
  const amountDollar = data.amount / 100;

  try {
    const res = await client.post('/invoice', {
      CustomerRef:  { value: String(data.customerId) },
      BillEmail:    { Address: data.email },
      DueDate:      data.dueDate,
      CurrencyRef:  { value: data.currency },
      Line: [
        {
          Amount:     amountDollar,
          DetailType: 'SalesItemLineDetail',
          Description: data.description,
          SalesItemLineDetail: {
            ItemRef:   { value: String(config.qbo.serviceItemId) },
            UnitPrice: amountDollar,
            Qty:       1,
          },
        },
      ],
    });
    return res.data.Invoice;
  } catch (err) {
    throw normaliseError(err);
  }
}

/**
 * High-level helper: create a QBO customer and a matching draft invoice.
 *
 * @param {{
 *   first_name       : string,
 *   last_name?       : string,
 *   email            : string,
 *   phone?           : string,
 *   amount           : number,   // cents
 *   currency         : string,
 *   line_description : string,
 *   due_days         : number,
 * }} opts
 * @returns {Promise<{ qboCustomer: object, qboInvoice: object }>}
 */
async function createQBOClientWithInvoice(opts) {
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + (opts.due_days ?? 30));
  const dueDateStr = dueDate.toISOString().split('T')[0];

  const qboCustomer = await createQBOCustomer({
    first_name: opts.first_name,
    last_name:  opts.last_name,
    email:      opts.email,
    phone:      opts.phone,
  });

  const qboInvoice = await createQBOInvoice({
    customerId:  qboCustomer.Id,
    amount:      opts.amount,
    currency:    opts.currency,
    description: opts.line_description,
    email:       opts.email,
    dueDate:     dueDateStr,
  });

  return { qboCustomer, qboInvoice };
}

module.exports = { createQBOCustomer, createQBOInvoice, createQBOClientWithInvoice };
