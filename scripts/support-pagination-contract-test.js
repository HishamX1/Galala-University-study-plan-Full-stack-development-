import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [frontend, html] = await Promise.all([
  readFile(new URL('../frontend/admin/modules/auth.js', import.meta.url), 'utf8'),
  readFile(new URL('../frontend/admin/index.html', import.meta.url), 'utf8')
]);
assert.match(frontend, /SUPPORT_PAGE_SIZE = 50/);
assert.match(frontend, /\/admin\/complaints\?limit=\$\{SUPPORT_PAGE_SIZE\}&offset=/);
assert.match(frontend, /\/admin\/communications\?limit=\$\{SUPPORT_PAGE_SIZE\}&offset=/);
assert.match(frontend, /data-support-page="\$\{kind\}"/);
assert.match(frontend, /requestsPanel\._supportPageListener = true/);
assert.match(html, /id="complaintsPagination"/);
assert.match(html, /id="communicationsPagination"/);
console.log('Support-list pagination and bounded initial loading contracts passed.');
