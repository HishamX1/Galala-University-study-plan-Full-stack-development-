import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const pages = [
  'frontend/password-reset-request.html',
  'frontend/reset-password.html',
  'frontend/student-login.html'
];

for (const page of pages) {
  const html = readFileSync(page, 'utf8');
  assert.match(html, /<nav\b[^>]*aria-label=/i, `${page} should expose named navigation links`);
  for (const [, href] of html.matchAll(/<a\b[^>]*href="([^"]+)"/gi)) {
    assert(!/^(?:https?:|#|javascript:)/i.test(href), `${page} navigation must stay on known local routes`);
    assert(existsSync(resolve(dirname(page), href.split(/[?#]/, 1)[0])), `${page} links to missing route ${href}`);
  }
}

const resetPage = readFileSync('frontend/reset-password.html', 'utf8');
assert.match(resetPage, /href="password-reset-request\.html"[^>]*>Request a new reset link/i,
  'reset screen should provide a recovery route for invalid or expired links');
const resetScript = readFileSync('frontend/reset-password.js', 'utf8');
assert.match(resetScript, /if\s*\(!token\)[\s\S]*?form\.hidden\s*=\s*true/,
  'missing-token state should be identified before password submission');
assert.match(resetScript, /location\.assign\('student-login\.html\?passwordReset=success'\)/,
  'successful reset should return to student login with a confirmation state');
const loginScript = readFileSync('frontend/auth.js', 'utf8');
assert.match(loginScript, /passwordReset["']\)\s*===\s*["']success["'][\s\S]*?updated successfully/i,
  'student login should show a distinct successful-reset message');

console.log('Password-recovery navigation contract tests passed.');
