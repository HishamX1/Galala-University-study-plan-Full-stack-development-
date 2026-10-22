import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const pages = [
  'frontend/password-reset-request.html',
  'frontend/reset-password.html',
  'frontend/student-login.html',
  'frontend/student-password-reset-request.html'
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
const studentLoginPage = readFileSync('frontend/student-login.html', 'utf8');
assert.match(studentLoginPage, /href="student-password-reset-request\.html"[^>]*>Forgot password\?/i,
  'student login should use the student email-reset flow');
const adminResetPage = readFileSync('frontend/password-reset-request.html', 'utf8');
assert.match(adminResetPage, /sent to an administrator for review/i,
  'the legacy reset request page should clearly retain the manual administrator-review behavior');
const resetScript = readFileSync('frontend/reset-password.js', 'utf8');
assert.match(resetScript, /if\s*\(!token\)[\s\S]*?form\.hidden\s*=\s*true/,
  'missing-token state should be identified before password submission');
assert.match(resetScript, /audience\s*===\s*['"]student['"][\s\S]*student-password-reset-request\.html/,
  'student reset links should retry through the email-based student flow');
assert.match(resetScript, /success\.textContent\s*=\s*['"]Your password was updated successfully/i,
  'successful password reset should confirm inline without redirecting admin resets to student login');
assert.match(resetPage, /href="admin-login\.html"/,
  'the shared reset page should retain an administrator sign-in route');

console.log('Password-recovery navigation contract tests passed.');
