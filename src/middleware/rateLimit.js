'use strict';

const rateLimit = require('express-rate-limit');

/**
 * Rate limiter for POST /api/agreement.
 *
 * 5 submissions per IP per 15 minutes. This is generous for a real human
 * signing an agreement but blocks trivial scripted spam.
 */
const agreementLimiter = rateLimit({
  windowMs:       15 * 60 * 1000, // 15 minutes
  max:            5,
  standardHeaders: true,   // Return rate limit info in `RateLimit-*` headers
  legacyHeaders:  false,
  message:        { ok: false, error: 'Too many requests — please try again later.' },
  skipSuccessfulRequests: false,
});

/**
 * General API limiter applied to all /api/* routes.
 * 120 requests per IP per minute — permissive but stops runaway loops.
 */
const apiLimiter = rateLimit({
  windowMs:       60 * 1000, // 1 minute
  max:            120,
  standardHeaders: true,
  legacyHeaders:  false,
  message:        { ok: false, error: 'Too many requests — please try again later.' },
});

module.exports = { agreementLimiter, apiLimiter };
