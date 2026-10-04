import assert from 'node:assert/strict';
import fs from 'node:fs';
import { escapeHtml } from '../frontend/shared/dom.js';

const studentSource = fs.readFileSync(new URL('../frontend/student/student.js', import.meta.url), 'utf8');
const malicious = '<img src=x onerror=alert(1)><script>alert(1)</script>" data-x="';
const escaped = escapeHtml(malicious);

assert.equal(escaped, '&lt;img src=x onerror=alert(1)&gt;&lt;script&gt;alert(1)&lt;/script&gt;&quot; data-x=&quot;');
assert.ok(!escaped.includes('<img'));
assert.ok(!escaped.includes('<script'));
assert.ok(escaped.includes('&lt;img'));
assert.ok(escaped.includes('&lt;script'));

// No catalog value may be directly interpolated into an HTML text node or
// attribute. The source still contains these expressions inside escapeHtml()
// arguments, which is safe and intentionally allowed.
const unsafeDirectInterpolations = [
  />\$\{(?:faculty|program|course|item)\.(?:name|code|id)\}</,
  /aria-label="[^"]*\$\{(?:faculty|program|course|item)\.(?:name|code|id)\}/,
  /data-(?:faculty|program|course)-id="\$\{(?:faculty|program|course)\.id\}"/
];
for (const pattern of unsafeDirectInterpolations) {
  assert.equal(pattern.test(studentSource), false, `unsafe catalog interpolation remains: ${pattern}`);
}

assert.equal(escapeHtml('ENG-101'), 'ENG-101');
assert.equal(escapeHtml('Introduction to Programming'), 'Introduction to Programming');
console.log('Student catalog stored-XSS regression test passed.');
