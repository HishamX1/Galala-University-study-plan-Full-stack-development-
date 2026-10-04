import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { handleApi } from '../backend/src/routes/catalogRoutes.js';
import { env } from '../backend/src/config/env.js';

function request(path, client) {
  const req = Readable.from([Buffer.from('{}')]);
  Object.assign(req, {
    method: 'POST',
    url: path,
    headers: { 'x-forwarded-for': client },
    socket: { remoteAddress: client }
  });
  return req;
}

function response() {
  return {
    status: null,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name] = value; },
    writeHead(status, headers = {}) { this.status = status; Object.assign(this.headers, headers); },
    end(body = '') { this.body += body; }
  };
}

const signupPath = `${env.apiBasePath}/auth/student-signup`;
const client = `signup-test-${Date.now()}`;
for (let attempt = 1; attempt <= 5; attempt += 1) {
  const res = response();
  await handleApi(request(signupPath, client), res, new URL(`http://localhost${signupPath}`));
  assert.equal(res.status, 400, `signup attempt ${attempt} should reach normal validation`);
}

const limited = response();
await handleApi(request(signupPath, client), limited, new URL(`http://localhost${signupPath}`));
assert.equal(limited.status, 429);
assert.deepEqual(JSON.parse(limited.body), { error: 'Too many requests. Please try again shortly.' });
assert.equal(limited.headers['Retry-After'], '900');

const unrelated = response();
const loginPath = `${env.apiBasePath}/auth/login`;
await handleApi(request(loginPath, `${client}-login`), unrelated, new URL(`http://localhost${loginPath}`));
assert.equal(unrelated.status, 400, 'login rate limiting must not share the signup bucket');

console.log('Student signup rate-limit regression test passed.');
