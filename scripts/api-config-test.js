import assert from 'node:assert/strict';
import { getApiCandidates } from '../frontend/shared/apiConfig.js';

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

setBrowser({ origin: 'https://static.example', hostname: 'static.example', port: '', configured: '' });
assert.ok(!getApiCandidates().some((candidate) => candidate === 'https://static.example/api'));

console.log('api-config tests passed');
