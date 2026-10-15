'use strict';
// Vercel serverless entry point. vercel.json rewrites /api/* and /healthz here;
// req.url keeps the original path, so the shared handler routes as usual.
const { handler } = require('../server');

module.exports = handler;
