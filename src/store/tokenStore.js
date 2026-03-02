'use strict';

/**
 * Lightweight persistent token store backed by a JSON file.
 *
 * Why a file and not env vars?
 *   QuickBooks rotates the refresh token on every use.  Storing it in an env
 *   variable means the first rotation invalidates whatever you pasted in and
 *   the next call gets `invalid_grant`.  A file that is written on every
 *   rotation survives process restarts and keeps the current valid token.
 *
 * Configuration:
 *   TOKEN_STORE_PATH — absolute path to the JSON file.
 *     • Render persistent disk  →  /data/qbo_tokens.json   (truly permanent)
 *     • Default                 →  /tmp/qbo_tokens.json    (survives restarts,
 *                                                            wiped on redeploy)
 *
 * Shape of the stored object:
 *   {
 *     "qbo_refresh_token": "AB11...",
 *     "qbo_realm_id":      "1234567890",
 *     "updated_at":        "2026-03-01T12:00:00.000Z"
 *   }
 */

const fs   = require('fs');
const path = require('path');

const STORE_PATH = process.env.TOKEN_STORE_PATH || '/tmp/qbo_tokens.json';

/** Read the full store object; returns {} when the file does not exist yet. */
function load() {
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Merge `fields` into the store and write it back to disk atomically.
 * Existing keys not included in `fields` are preserved.
 *
 * @param {Record<string, string>} fields  e.g. { qbo_refresh_token: '...' }
 */
function save(fields) {
  try {
    const dir = path.dirname(STORE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const merged = { ...load(), ...fields, updated_at: new Date().toISOString() };
    // Write to a temp file then rename for atomicity (prevents partial writes).
    const tmp = STORE_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(merged, null, 2));
    fs.renameSync(tmp, STORE_PATH);
  } catch (err) {
    console.warn('[tokenStore] Could not write to store:', err.message);
  }
}

/** Convenience: get a single field value (or undefined). */
function get(field) {
  return load()[field];
}

module.exports = { load, save, get, STORE_PATH };
