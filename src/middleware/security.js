'use strict';

const helmet = require('helmet');
const cors   = require('cors');

// ─── CORS ─────────────────────────────────────────────────────────────────────
// The form is served from the same origin, so same-origin requests don't need
// CORS headers at all. This allowlist covers cross-origin callers only.
const ALLOWED_ORIGINS = [
  'https://simpltech-payment.onrender.com',
  ...(process.env.ALLOWED_ORIGIN ? [process.env.ALLOWED_ORIGIN] : []),
];

const corsMiddleware = cors({
  origin(origin, cb) {
    // No origin header = server-to-server or same-origin — allow.
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin not allowed: ${origin}`));
  },
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
  maxAge: 600, // 10-minute preflight cache
});

// ─── Helmet (security headers) ────────────────────────────────────────────────
// CSP is intentionally permissive on scripts/styles with unsafe-inline because
// the agreement.html page uses inline JS for signature capture. Tighten once
// nonces are wired in.
const helmetMiddleware = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'", "'unsafe-inline'"],
      styleSrc:    ["'self'", "'unsafe-inline'"],
      imgSrc:      ["'self'", 'data:', 'blob:'],
      connectSrc:  ["'self'", 'https://public-api.alternativepayments.io'],
      frameSrc:    ["'none'"],
      objectSrc:   ["'none'"],
      baseUri:     ["'self'"],
      formAction:  ["'self'"],
    },
  },
  hsts: {
    maxAge:            63_072_000, // 2 years
    includeSubDomains: true,
    preload:           true,
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  frameguard:     { action: 'deny' },
  noSniff:        true,
  xssFilter:      true,
});

module.exports = { corsMiddleware, helmetMiddleware };
