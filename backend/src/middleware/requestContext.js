import crypto from 'node:crypto';

export function assignRequestId(req, res) {
  const provided = String(req.headers['x-request-id'] || '');
  req.requestId = /^[A-Za-z0-9._-]{8,128}$/.test(provided) ? provided : crypto.randomUUID();
  res.setHeader('X-Request-ID', req.requestId);
}

export const CONTENT_SECURITY_POLICY = "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data:; connect-src 'self' https://galala-university-study-plan-full-stack-kd69.onrender.com http://localhost:4000 http://127.0.0.1:4000";

export function applySecurityHeaders(res, req = null) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  const forwardedProtocol = String(req?.headers?.['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  const isHttps = forwardedProtocol === 'https' || Boolean(req?.socket?.encrypted);
  if (process.env.NODE_ENV === 'production' && isHttps) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
}

export function safeRequestLog(req, res, started) {
  console.info(JSON.stringify({ requestId: req.requestId, method: req.method, path: new URL(req.url, 'http://localhost').pathname, status: res.statusCode, durationMs: Date.now() - started }));
}
