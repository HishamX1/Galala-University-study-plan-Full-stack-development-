import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const cleanEnvironment = Object.fromEntries(
  ['PATH', 'SystemRoot', 'WINDIR', 'PATHEXT', 'TEMP', 'TMP']
    .filter((key) => process.env[key])
    .map((key) => [key, process.env[key]])
);
const result = spawnSync(process.execPath, ['scripts/doctor.js'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  env: cleanEnvironment
});

assert.ifError(result.error);
const output = `${result.stdout || ''}\n${result.stderr || ''}`;
assert.equal(result.status, 1, 'the isolated doctor run should fail only because no database is configured');
assert.match(output, /Vercel project settings are managed externally and cannot be verified/);
assert.match(output, /netlify\.toml is retained legacy configuration/);
assert.match(output, /Provider dashboard settings and production readiness are not verified by this doctor/);
assert.doesNotMatch(output, /✓ Netlify (publish directory|security headers)/);
assert.match(output, /DATABASE_URL is missing/);

console.log('Deployment doctor correctly distinguishes local checks from provider verification.');
