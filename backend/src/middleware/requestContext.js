import crypto from 'node:crypto';

export function assignRequestId(req, res) {
  const provided = String(req.headers['x-request-id'] || '');
  req.requestId = /^[A-Za-z0-9._-]{8,128}$/.test(provided) ? provided : crypto.randomUUID();
  res.setHeader('X-Request-ID', req.requestId);
}

export function applySecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}

export function safeRequestLog(req, res, started) {
  console.info(JSON.stringify({ requestId: req.requestId, method: req.method, path: new URL(req.url, 'http://localhost').pathname, status: res.statusCode, durationMs: Date.now() - started }));
}
