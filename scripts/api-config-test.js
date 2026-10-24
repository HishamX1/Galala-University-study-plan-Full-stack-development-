import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getApiCandidates, normalizeApiBase, saveApiBase, PRODUCTION_API_BASE } from '../frontend/shared/apiConfig.js';
import { CONTENT_SECURITY_POLICY as BACKEND_CSP } from '../backend/src/middleware/requestContext.js';

setBrowser({ origin: 'http://localhost:5500', hostname: 'localhost', port: '5500' });
await import(`../frontend/config.js?local-config=${Date.now()}`);
assert.equal(window.__GU_API_BASE__, 'http://localhost:4000/api', 'static localhost frontend points to the local backend');
setBrowser({ origin: 'https://static.example', hostname: 'static.example', port: '' });
await import(`../frontend/config.js?production-config=${Date.now()}`);
assert.equal(window.__GU_API_BASE__, PRODUCTION_API_BASE, 'deployed static config uses the shared production API source');

function setBrowser({ origin, hostname, port, search = '', configured, stored, meta }) {
  globalThis.window = { location: { origin, hostname, port, protocol: `${origin.split(':')[0]}:`, search }, ...(configured === undefined ? {} : { __GU_API_BASE__: configured }) };
  globalThis.localStorage = { getItem: () => stored || null };
  globalThis.document = { querySelector: () => meta ? { content: meta } : null };
}

setBrowser({ origin: 'http://localhost:4000', hostname: 'localhost', port: '4000' });
assert.deepEqual(getApiCandidates(), ['/api', 'http://127.0.0.1:4000/api', 'http://localhost:4000/api']);

setBrowser({ origin: 'https://galala-university-study-plan-center.vercel.app', hostname: 'galala-university-study-plan-center.vercel.app', port: '' });
assert.deepEqual(getApiCandidates(), ['https://galala-university-study-plan-full-stack-kd69.onrender.com/api']);

setBrowser({ origin: 'https://static.example', hostname: 'static.example', port: '', search: '?apiBase=https://override.example' });
assert.equal(getApiCandidates()[0], 'https://override.example/api');
setBrowser({ origin: 'https://static.example', hostname: 'static.example', port: '', configured: 'https://configured.example/api', search: '?apiBase=https://temporary.example' });
assert.deepEqual(getApiCandidates(), ['https://temporary.example/api'], 'a deliberate query diagnostic is temporary and does not silently fail over');

setBrowser({ origin: 'https://static.example', hostname: 'static.example', port: '', configured: '' });
assert.ok(!getApiCandidates().some((candidate) => candidate === 'https://static.example/api'));

assert.equal(normalizeApiBase('https://api.example.test/base///'), 'https://api.example.test/base/api');
assert.equal(normalizeApiBase('javascript:alert(1)'), '');
assert.equal(normalizeApiBase('https://user:pass@api.example.test'), '');
assert.equal(normalizeApiBase('https://api.example.test?token=secret'), '');

setBrowser({ origin: 'https://static.example', hostname: 'static.example', port: '', configured: 'not a url', search: '?apiBase=also-invalid', stored: 'javascript:alert(1)' });
assert.deepEqual(getApiCandidates(), ['https://galala-university-study-plan-full-stack-kd69.onrender.com/api'], 'invalid overrides fall back to the deployed runtime default');
assert.equal(saveApiBase('not a url'), '', 'invalid values are not persisted');

const vercel = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const vercelCsp = vercel.headers[0].headers.find((header) => header.key === 'Content-Security-Policy').value;
const apiOrigin = new URL(PRODUCTION_API_BASE).origin;
assert.ok(vercelCsp.includes(`connect-src 'self' ${apiOrigin}`), 'Vercel CSP permits exactly the configured API origin');
assert.ok(BACKEND_CSP.includes(apiOrigin), 'backend CSP and frontend runtime API share the production origin');
assert.match(vercelCsp, /http:\/\/localhost:4000/);
assert.match(vercelCsp, /http:\/\/127\.0\.0\.1:4000/);
const runtimeConfig = fs.readFileSync(new URL('../frontend/config.js', import.meta.url), 'utf8');
assert.match(runtimeConfig, /import \{ PRODUCTION_API_BASE \} from '\.\/shared\/apiConfig\.js'/);
assert.doesNotMatch(runtimeConfig, /onrender\.com/, 'the frontend production hostname has one runtime source');
const deploymentDocs = fs.readFileSync(new URL('../docs/deployment.md', import.meta.url), 'utf8');
assert.match(deploymentDocs, /https:\/\/galala-university-study-plan-center\.vercel\.app/,
  'the documented production CORS origin is explicit and marked for owner dashboard verification');
const routeSource = fs.readFileSync(new URL('../backend/src/routes/catalogRoutes.js', import.meta.url), 'utf8');
assert.match(routeSource, /env\.corsOrigins\.includes\(origin\)/, 'credentialed CORS uses exact allowlisted origins');
assert.match(routeSource, /Access-Control-Allow-Credentials', 'true'/);
assert.doesNotMatch(routeSource, /Access-Control-Allow-Origin', '\*'/);

console.log('api-config tests passed');
