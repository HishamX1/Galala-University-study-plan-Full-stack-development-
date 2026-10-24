import assert from 'node:assert/strict';
import fs from 'node:fs';

const doctor = fs.readFileSync('scripts/doctor.js', 'utf8');
const deploymentGuide = fs.readFileSync('docs/deployment.md', 'utf8');
const vercel = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));

assert.match(doctor, /getPasswordResetEmailConfig\(\)/,
  'the deployment doctor should catch missing or invalid student recovery email configuration');
assert.match(doctor, /required backend settings are missing or invalid/,
  'the doctor should report email configuration failure without printing secret values');
assert.match(doctor, /Vercel dashboard project-root, environment, and override settings are not inspected/,
  'the doctor must distinguish local repository checks from provider-dashboard verification');
assert.equal(vercel.outputDirectory, 'frontend', 'Vercel publishes the canonical static frontend directory');
assert.deepEqual(vercel.rewrites, [
  { source: '/', destination: '/index.html' },
  { source: '/student', destination: '/student/index.html' },
  { source: '/admin', destination: '/admin/index.html' }
], 'Vercel directly serves the landing, student, and admin entry points');
assert.equal(fs.existsSync('netlify.toml'), false, 'the legacy Netlify deployment manifest is removed');
assert.equal(fs.existsSync('frontend/student-login.html'), true, 'direct .html pages remain in Vercel output');
assert.equal(fs.existsSync('frontend/images/GU-Logo-Color-Original.png'), true, 'static assets remain in Vercel output');
const headers = vercel.headers.find((rule) => rule.source === '/(.*)')?.headers || [];
const headerValues = new Map(headers.map(({ key, value }) => [key.toLowerCase(), value]));
for (const name of ['x-content-type-options', 'x-frame-options', 'referrer-policy', 'permissions-policy', 'content-security-policy', 'strict-transport-security']) {
  assert.ok(headerValues.has(name), `Vercel applies ${name} to static pages and assets`);
}
assert.equal(headerValues.get('x-content-type-options'), 'nosniff');
assert.equal(headerValues.get('x-frame-options'), 'DENY');
assert.equal(headerValues.get('referrer-policy'), 'strict-origin-when-cross-origin');
assert.equal(headerValues.get('strict-transport-security'), 'max-age=31536000');
const csp = headerValues.get('content-security-policy');
for (const directive of ["default-src 'self'", "script-src 'self' 'unsafe-inline'", 'https://fonts.googleapis.com', 'https://fonts.gstatic.com', 'https://galala-university-study-plan-full-stack-kd69.onrender.com', 'http://localhost:4000', 'http://127.0.0.1:4000']) {
  assert.ok(csp.includes(directive), `Vercel CSP preserves ${directive}`);
}
assert.equal(vercel.rewrites.some((route) => route.destination.startsWith('/api')), false, 'authenticated API traffic remains direct to Render');
assert.equal(headers.some(({ key }) => key.toLowerCase() === 'cache-control'), false, 'Vercel does not add shared caching to authenticated API responses');
assert.equal(vercel.rewrites.some((route) => route.source === '/student' && route.destination === '/student/index.html'), true,
  'the Vercel student route maps directly to its static entry file');
assert.match(doctor, /vercel\.json/);
assert.match(doctor, /Vercel static output directory/);
assert.match(doctor, /Vercel dashboard project-root, environment, and override settings are not inspected/);
assert.doesNotMatch(doctor, /resendApiKey\s*\}|resendFromEmail\s*\}|publicAppUrl\s*\}/,
  'the doctor must not print password-reset provider secrets or configured URLs');
assert.match(deploymentGuide, /active frontend host is Vercel/i);
assert.match(deploymentGuide, /RESEND_API_KEY[\s\S]*RESEND_FROM_EMAIL[\s\S]*PUBLIC_APP_URL/,
  'the release guide should list the backend-only reset-mail configuration requirements');
assert.match(deploymentGuide, /repository root[\s\S]*vercel\.json[\s\S]*frontend\//i,
  'the release guide must make the Vercel project-root assumption explicit');
assert.match(deploymentGuide, /private dashboard settings/i,
  'the guide must distinguish repository checks from private Vercel dashboard settings');
assert.doesNotMatch(deploymentGuide, /netlify/i, 'active deployment instructions must not direct operators to Netlify');

console.log('Deployment doctor provider-boundary and release-documentation contract tests passed.');
