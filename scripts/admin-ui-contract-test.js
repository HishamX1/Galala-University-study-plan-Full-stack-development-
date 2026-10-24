import assert from 'node:assert/strict';
import fs from 'node:fs';

const fakeElements = new Map();
globalThis.document = { getElementById: (id) => fakeElements.get(id) || null };
const { withButtonBusy, withAdminLoading } = await import('../frontend/admin/modules/adminDom.js');
const { expectedRelationVersion } = await import('../frontend/admin/modules/prerequisites.js');

const html = fs.readFileSync(new URL('../frontend/admin/index.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../frontend/admin/admin.css', import.meta.url), 'utf8');
const auth = fs.readFileSync(new URL('../frontend/admin/modules/auth.js', import.meta.url), 'utf8');
const dialogs = fs.readFileSync(new URL('../frontend/admin/modules/dialogs.js', import.meta.url), 'utf8');
const adminOps = fs.readFileSync(new URL('../frontend/admin/modules/adminOps.js', import.meta.url), 'utf8');
const adminDom = fs.readFileSync(new URL('../frontend/admin/modules/adminDom.js', import.meta.url), 'utf8');
const forms = fs.readFileSync(new URL('../frontend/admin/modules/forms.js', import.meta.url), 'utf8');
const renderLists = fs.readFileSync(new URL('../frontend/admin/modules/renderLists.js', import.meta.url), 'utf8');
const dialogsSource = fs.readFileSync(new URL('../frontend/admin/modules/dialogs.js', import.meta.url), 'utf8');

assert.deepEqual(expectedRelationVersion({ version: { updatedAt: '2026-10-24T13:23:41.490000Z', relatedUpdatedAt: '2026-10-23T10:00:00.000000Z' } }),
  { updatedAt: '2026-10-24T13:23:41.490000Z' }, 'relation writes send only the version field accepted by their endpoint');
assert.throws(() => expectedRelationVersion({ version: null }), /Refresh the catalog/,
  'relation writes fail safely rather than dropping optimistic concurrency when a version is missing');

const busyAttributes = new Set();
const busyButton = {
  disabled: false, isConnected: true, focused: false,
  setAttribute(name) { busyAttributes.add(name); },
  removeAttribute(name) { busyAttributes.delete(name); },
  closest() { return null; },
  focus() { this.focused = true; }
};
assert.equal(await withButtonBusy(busyButton, async () => {
  assert.equal(busyButton.disabled, true);
  assert.equal(busyAttributes.has('aria-busy'), true);
  return 'completed';
}), 'completed');
assert.equal(busyButton.disabled, false);
assert.equal(busyAttributes.has('aria-busy'), false);
assert.equal(busyButton.focused, true);
let releaseRequest;
let duplicateActionCalls = 0;
const actionGate = new Promise((resolve) => { releaseRequest = resolve; });
const firstSubmission = withButtonBusy(busyButton, async () => {
  duplicateActionCalls += 1;
  await actionGate;
  return 'single submission';
});
assert.equal(await withButtonBusy(busyButton, async () => { duplicateActionCalls += 1; }), undefined,
  'an overlapping submission is ignored while the first request is in flight');
assert.equal(duplicateActionCalls, 1, 'only the first action reaches the operation');
releaseRequest();
assert.equal(await firstSubmission, 'single submission');
assert.equal(busyButton.disabled, false, 'the control is restored after the in-flight request finishes');
await assert.rejects(() => withButtonBusy(busyButton, async () => { throw new Error('expected test failure'); }), /expected test failure/);
assert.equal(busyButton.disabled, false, 'busy controls are restored after a failed request');
busyButton.disabled = true;
assert.equal(await withButtonBusy(busyButton, async () => 'should not run'), undefined, 'disabled controls cannot submit a duplicate action');
busyButton.disabled = false;

const loadingOverlay = { hidden: true };
const loadingLabel = { textContent: '' };
fakeElements.set('adminLoadingOverlay', loadingOverlay);
fakeElements.set('adminLoadingMessage', loadingLabel);
await assert.rejects(withAdminLoading('Loading test page', () => {
  assert.equal(loadingOverlay.hidden, false, 'the overlay is visible while work is in progress');
  return new Promise(() => {});
}, 5), /taking too long to load/i);
assert.equal(loadingOverlay.hidden, true, 'the full-screen loading overlay is released after the loading deadline');
assert.equal(loadingLabel.textContent, 'Loading test page');
await withAdminLoading('Loading completed section', async () => 'done', 5);
assert.equal(loadingOverlay.hidden, true, 'the full-screen overlay hides after successful completion');

const tabs = [...html.matchAll(/<button([^>]*)role="tab"([^>]*)>([\s\S]*?)<\/button>/g)].map(([, before, after, content]) => {
  const attributes = `${before} ${after}`;
  return [attributes.match(/data-admin-tab="([^"]+)"/)?.[1], attributes.match(/aria-controls="([^"]+)"/)?.[1], content];
});
const panels = [...html.matchAll(/<div id="([^"]+)" role="tabpanel" aria-labelledby="([^"]+)"[^>]*data-admin-panel="([^"]+)"[^>]*>/g)];
assert.equal(tabs.length, 9, 'all administrator sections stay represented by accessible tabs');
assert.equal(panels.length, 9, 'each tab has a corresponding labeled panel');
for (const [tab, panelId, content] of tabs) {
  assert.match(content, /<svg class="admin-tab-icon" aria-hidden="true">/, `${tab} has a decorative icon hidden from assistive technology`);
  assert.match(content, /<span>[^<]+<\/span>/, `${tab} keeps an explicit visible text label`);
  assert.ok(panels.some(([, id, labelledBy, panel]) => id === panelId && labelledBy === `admin-tab-${tab}` && panel === tab), `${tab} points to its matching panel`);
}
for (const purpose of ['Current catalog totals', 'Create and maintain faculties', 'Search recorded system actions', 'Review removed catalog records', 'Validate and stage incoming data', 'Create downloadable snapshots', 'backend, database, integration', 'Create accounts, review access', 'Review account recovery requests']) {
  assert.ok(html.includes(purpose), `panel descriptions explain purpose: ${purpose}`);
}
for (const icon of ['dashboard', 'catalog', 'audit', 'recycle', 'transfer', 'backup', 'health', 'users', 'requests']) {
  assert.ok(html.includes(`id="admin-icon-${icon}"`), `inline icon symbol exists: ${icon}`);
}
assert.match(html, /id="error" role="alert" aria-live="assertive"/);
assert.match(html, /id="success" role="status" aria-live="polite"/);
assert.match(html, /id="progress" role="status" aria-live="polite"/);
assert.match(html, /aria-describedby="adminDialogDescription"/);
for (const id of ['apiBaseUrl', 'adminUsername', 'adminPassword', 'facultyName', 'programFaculty', 'programName', 'programDurationYears', 'courseProgram', 'courseYearNo', 'courseSemesterNo', 'courseCode', 'courseName', 'courseCredits', 'courseDescription', 'coursePrereqs', 'courseSearch', 'courseFilterFaculty', 'courseFilterProgram', 'courseFilterYear', 'courseFilterSemester', 'courseFilterRelations', 'courseFilterVisibility', 'auditSearch', 'auditRange', 'auditEntity', 'auditCategory', 'auditActor', 'auditFrom', 'auditTo', 'auditOrder', 'importType', 'importFormat', 'importFile', 'importContent', 'exportFormat', 'backupFormat', 'userSearch', 'userRoleFilter', 'userStatusFilter', 'managedUserName', 'managedUserEmail', 'managedUserStudentId', 'managedUserPassword', 'managedUserRole', 'managedUserStatus']) {
  assert.ok(new RegExp(`<label[^>]*for="${id}"`).test(html), `form control ${id} has an explicit associated label`);
}
assert.match(html, /<link rel="stylesheet" href="\.\/admin\.css"/);
assert.match(css, /@media \(max-width: 900px\)/);
assert.match(css, /@media \(max-width: 620px\)/);
assert.match(css, /prefers-reduced-motion: reduce/);
assert.match(css, /:focus-visible/);
assert.match(css, /\.admin-shell table \{ min-width:/, 'wide tables remain scrollable instead of crushing columns on narrow screens');
assert.match(css, /\.admin-shell td \{ vertical-align: top; overflow-wrap: anywhere; \}/, 'long English or Arabic names wrap within their cells');
assert.match(css, /\.admin-user-badge \{[^}]*overflow-wrap: anywhere;/);
assert.equal((html.match(/class="table-wrap[^"]*" role="region" aria-label="[^"]+" tabindex="0"/g) || []).length, 9, 'all horizontally scrollable tables are keyboard-focusable named regions');
assert.match(adminOps, /ArrowRight/);
assert.match(adminOps, /event\.key === 'Home'/);
assert.match(adminOps, /withButtonBusy\(actionButton/);
assert.match(adminDom, /setAttribute\('aria-busy', 'true'\)/);
assert.match(adminDom, /elements\.progress\.hidden = type !== 'progress'/);
assert.match(adminDom, /showAdminError\(message, remembered\)/, 'admin action failures open the central error dialog');
assert.match(adminDom, /Date\.now\(\) - lastErrorTime < 3000/, 'duplicate errors are suppressed briefly');
assert.match(adminDom, /overlay\.hidden = adminLoadingCount === 0/, 'branded loading UI hides when all work has completed');
assert.match(adminDom, /ADMIN_LOADING_TIMEOUT_MS = 20_000/, 'the full-screen loading state has a bounded wait');
assert.match(auth, /await withAdminLoading\('Loading the academic catalog and dashboard/, 'initial admin data loading is awaited and its failure is handled');
assert.match(html, /id="adminErrorDialog"[^>]*aria-labelledby=/);
assert.match(html, /id="adminErrorRequestId"/);
assert.match(html, /data-admin-error-report/);
assert.match(html, /id="adminLoadingOverlay"[^>]*role="status"/);
assert.match(html, /GU-Logo-Color-Original\.png/);
assert.match(css, /prefers-reduced-motion: reduce[\s\S]*admin-loading-spinner/);
assert.match(dialogs, /event\.key !== 'Tab'/);
assert.match(dialogs, /event\.key === 'Escape'/, 'dialogs provide a keyboard cancel action');
assert.match(dialogs, /event\.shiftKey[\s\S]*last\.focus\(\)/, 'dialog focus remains trapped for reverse keyboard navigation');
assert.match(dialogs, /submitLabel = 'Delete', danger = true/);
assert.match(auth, /Approve & create link/);
assert.match(auth, /Assign complaint/);
assert.match(auth, /openFormDialog\(\{ title: 'Update complaint'/);
assert.match(auth, /draft = form;/, 'a failed complaint update retains the user-entered draft');
assert.match(auth, /saveError = error\.message;/, 'a failed complaint update exposes an actionable error for retry');
assert.doesNotMatch(auth, /if \(!confirm\(/, 'account deletion uses the accessible purpose-specific confirmation dialog');
assert.doesNotMatch(auth, /prompt\('Reply to the student/);
assert.match(auth, /escapeHtml\(u\.name\)/, 'user-controlled names are escaped in account rows');
assert.match(auth, /escapeHtml\(user\.name\)/, 'user-controlled names are escaped in account dialogs');
assert.match(auth, /escapeReport\(report\.message\)/, 'stored error report messages are escaped before rendering');
assert.match(auth, /data-error-report-copy/, 'report details provide a clipboard action');
assert.match(forms, /summarizeCourseImpact/);
assert.match(forms, /is moved to the recycle bin and disappears from the active student catalog/);
assert.match(forms, /data-delete="\$\{course\.id\}" data-kind="course"[^>]*>Move course to recycle bin/,
  'course details expose the standard soft-delete action');
assert.match(forms, /fromCourseDetails[\s\S]*?if \(!confirmed\)[\s\S]*?openCourseView\(current\)/,
  'cancelling course deletion returns the administrator to course details');
assert.equal((forms.match(/expectedVersion: expectedRelationVersion\(findCourse\(courseId\)\)/g) || []).length, 4,
  'all prerequisite add, visibility, and removal controls use a valid updatedAt version');
assert.match(renderLists, /Move to recycle bin/);
assert.match(renderLists, /aria-label="View course details:/);
assert.match(adminOps, /⚠ Permanently delete \$\{label\}\?/);
assert.match(adminOps, /cannot be undone or restored/);
assert.match(adminOps, /catalogAuditValues\(log\)/, 'audit rows expose catalog before/after values for review');
assert.match(adminOps, /\['faculty', 'program', 'course', 'relation'\]/, 'audit details are limited to catalog records');
assert.match(dialogsSource, /export function openContentDialog/);
assert.doesNotMatch(dialogsSource.match(/export function openContentDialog[\s\S]*?\n}/)?.[0] || '', /new Promise/,
  'read-only content dialogs do not leave unresolved submit handlers when a confirmation dialog replaces them');
assert.match(adminOps, /title: 'Publish the reviewed catalog import\?'/);

console.log('Administrator UI hierarchy, responsive/accessibility, action-feedback, and confirmation contracts passed.');
