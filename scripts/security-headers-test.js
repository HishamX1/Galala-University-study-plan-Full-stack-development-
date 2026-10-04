import assert from 'node:assert/strict';

process.env.NODE_ENV = 'production';
const { applySecurityHeaders, CONTENT_SECURITY_POLICY } = await import('../backend/src/middleware/requestContext.js');

function response() {
  return { headers: {}, setHeader(name, value) { this.headers[name] = value; } };
}

const httpsResponse = response();
applySecurityHeaders(httpsResponse, { headers: { 'x-forwarded-proto': 'https' }, socket: {} });
assert.equal(httpsResponse.headers['Strict-Transport-Security'], 'max-age=31536000');
assert.equal(httpsResponse.headers['Content-Security-Policy'], CONTENT_SECURITY_POLICY);
assert.equal(httpsResponse.headers['X-Content-Type-Options'], 'nosniff');
assert.equal(httpsResponse.headers['X-Frame-Options'], 'DENY');
assert.match(CONTENT_SECURITY_POLICY, /script-src 'self' 'unsafe-inline'/);
assert.doesNotMatch(CONTENT_SECURITY_POLICY, /unsafe-eval/);
assert.match(CONTENT_SECURITY_POLICY, /fonts\.googleapis\.com/);
assert.match(CONTENT_SECURITY_POLICY, /fonts\.gstatic\.com/);
assert.match(CONTENT_SECURITY_POLICY, /galala-university-study-plan-full-stack-kd69\.onrender\.com/);

const httpResponse = response();
applySecurityHeaders(httpResponse, { headers: { 'x-forwarded-proto': 'http' }, socket: {} });
assert.equal(httpResponse.headers['Strict-Transport-Security'], undefined);
assert.equal(httpResponse.headers['Content-Security-Policy'], CONTENT_SECURITY_POLICY);

console.log('Security header regression test passed.');
