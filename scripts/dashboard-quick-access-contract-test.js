import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ADMIN_TAB_ROLES, activateAdminTab, adminQuickAccessActions, adminTabHref, resolveAdminTab } from '../frontend/shared/adminNavigation.js';

assert.equal(adminTabHref('catalog'), './admin/index.html?tab=catalog');
assert.equal(adminTabHref('requests', '../admin/index.html'), '../admin/index.html?tab=requests');
assert.equal(adminTabHref('not-a-tab'), null);
assert.equal(resolveAdminTab('catalog', 'regular_admin').allowed, true);
assert.equal(resolveAdminTab('requests', 'super_admin').allowed, true);
assert.deepEqual(resolveAdminTab('users', 'regular_admin'), { allowed: false, reason: 'forbidden' });
assert.deepEqual(resolveAdminTab('not-a-tab', 'super_admin'), { allowed: false, reason: 'unknown' });
assert.equal(resolveAdminTab('catalog', 'student').allowed, false);
assert.deepEqual(Object.keys(ADMIN_TAB_ROLES), ['dashboard', 'catalog', 'audit', 'transfer', 'backup', 'recycle', 'health', 'users', 'requests']);
assert.deepEqual(adminQuickAccessActions('regular_admin', '../admin/index.html'), [
  ['Academic Catalog', '../admin/index.html?tab=catalog'], ['Add Course', '../admin/index.html?tab=catalog'],
  ['Manage Relations', '../admin/index.html?tab=catalog'], ['Import', '../admin/index.html?tab=transfer'],
  ['Program Management', '../admin/index.html?tab=catalog'], ['Faculty Management', '../admin/index.html?tab=catalog']
]);
assert.deepEqual(adminQuickAccessActions('super_admin', '../admin/index.html', '../student/index.html'), [
  ['Academic Catalog', '../admin/index.html?tab=catalog'],
  ['User Management', '../admin/index.html?tab=users'], ['Requests & Complaints', '../admin/index.html?tab=requests'],
  ['Audit Logs', '../admin/index.html?tab=audit'], ['Backup', '../admin/index.html?tab=backup'],
  ['Export', '../admin/index.html?tab=transfer'], ['Recycle Bin', '../admin/index.html?tab=recycle'],
  ['System Health', '../admin/index.html?tab=health'], ['Student Portal', '../student/index.html'],
  ['Admin Portal', '../admin/index.html?tab=dashboard']
]);
assert.equal(adminQuickAccessActions('student'), null);

function makeButton(tab, active = false, hidden = false) {
  const classes = new Set(active ? ['is-active'] : []);
  const attributes = {};
  return {
    dataset: { adminTab: tab }, hidden, disabled: false,
    focused: false,
    classList: { toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); }, contains(name) { return classes.has(name); } },
    setAttribute(name, value) { attributes[name] = value; },
    removeAttribute(name) { delete attributes[name]; },
    hasAttribute(name) { return Object.hasOwn(attributes, name); },
    getAttribute(name) { return attributes[name] ?? null; },
    focus() { this.focused = true; }
  };
}
function makePanel(tab, hidden = true) { return { dataset: { adminPanel: tab }, hidden }; }
function makeDom(role = 'super_admin') {
  return {
    buttons: Object.keys(ADMIN_TAB_ROLES).map((tab) => makeButton(tab, tab === 'dashboard', role !== 'super_admin' && ['recycle', 'health', 'users', 'requests'].includes(tab))),
    panels: Object.keys(ADMIN_TAB_ROLES).map((tab) => makePanel(tab, tab !== 'dashboard')),
    querySelectorAll(selector) { return selector === '[data-admin-tab]' ? this.buttons : this.panels; }
  };
}
function makeWindow(href) {
  const fake = { location: { href }, history: { replaceState(_state, _title, path) { fake.location.href = new URL(path, fake.location.href).href; } } };
  return fake;
}

const dom = makeDom();
const browser = makeWindow('https://example.test/admin/index.html?tab=requests&complaint=123#keep');
assert.equal(activateAdminTab('requests', 'super_admin', dom, browser), true);
assert.equal(dom.panels.find((panel) => panel.dataset.adminPanel === 'requests').hidden, false);
assert.equal(dom.buttons.find((button) => button.dataset.adminTab === 'requests').classList.contains('is-active'), true);
assert.equal(dom.buttons.find((button) => button.dataset.adminTab === 'requests').getAttribute('aria-selected'), 'true');
assert.equal(dom.buttons.find((button) => button.dataset.adminTab === 'requests').getAttribute('tabindex'), '0');
assert.equal(dom.buttons.find((button) => button.dataset.adminTab === 'dashboard').getAttribute('aria-selected'), 'false');

assert.equal(activateAdminTab('users', 'regular_admin', dom, browser), false, 'role-hidden tabs cannot be activated by direct navigation');
assert.equal(dom.panels.find((panel) => panel.dataset.adminPanel === 'requests').hidden, false);
assert.equal(activateAdminTab('audit', 'super_admin', dom, browser), true);
const savedUrl = new URL(browser.location.href);
assert.equal(savedUrl.searchParams.get('tab'), 'audit');
assert.equal(savedUrl.searchParams.has('complaint'), false, 'leaving the request tab clears stale detail deep links');
assert.equal(savedUrl.hash, '#keep');

const refreshedDom = makeDom();
const refreshedUrl = new URL(browser.location.href);
assert.equal(activateAdminTab(resolveAdminTab(refreshedUrl.searchParams.get('tab'), 'super_admin').tab, 'super_admin', refreshedDom, browser, { updateUrl: false }), true);
assert.equal(refreshedDom.panels.find((panel) => panel.dataset.adminPanel === 'audit').hidden, false, 'the selected tab can be restored from the URL after reload');
assert.equal(activateAdminTab('catalog', 'super_admin', refreshedDom, browser, { updateUrl: false, focus: true }), true);
assert.equal(refreshedDom.buttons.find((button) => button.dataset.adminTab === 'catalog').focused, true, 'keyboard navigation can move focus to the selected tab');

const dashboard = fs.readFileSync(new URL('../frontend/dashboard.js', import.meta.url), 'utf8');
const adminOps = fs.readFileSync(new URL('../frontend/admin/modules/adminOps.js', import.meta.url), 'utf8');
const adminAuth = fs.readFileSync(new URL('../frontend/admin/modules/auth.js', import.meta.url), 'utf8');
const adminHtml = fs.readFileSync(new URL('../frontend/admin/index.html', import.meta.url), 'utf8');
assert.match(dashboard, /adminQuickAccessActions\(role, portalPath\('admin'\), portalPath\('student'\)\)/);
assert.doesNotMatch(dashboard, /portalPath\('admin'\)\}#/);
assert.match(adminOps, /activateAdminTab\(quick\.dataset\.quick, cache\.adminRole\)/);
assert.doesNotMatch(adminOps, /querySelector\(`\[data-admin-tab=/);
assert.match(adminAuth, /activateAdminTab\(tab, role, document, window, \{ updateUrl: false \}\)/);
assert.match(adminAuth, /await openRequestedAdminDestination\(user\.role, getManagedUsers\)/);
assert.equal((adminAuth.match(/await loadInitialAdminData\(user\.role\)/g) || []).length, 2,
  'login and session restoration use the shared concurrent workspace initializer');
assert.match(adminAuth, /if \(role === 'super_admin' && tab === 'requests'\) await loadControlCenter\(loadUsers\(\)\)/,
  'direct request-tab links load their data before presenting complaint or reset details');
assert.match(adminAuth, /if \(role === 'super_admin' && tab === 'users'\) await loadUsers\(\)/,
  'direct user-management links load the account list');
assert.match(adminAuth, /loadRelations\(\)\.catch\(\(error\) => setMessage\('error', `Catalog could not be loaded: \$\{error\.message\}`\)\)/,
  'catalog loading failure is surfaced without blocking the control panel');
assert.match(adminAuth, /loadAdminOps\(\)\.catch\(\(error\) => setMessage\('error', `Dashboard operations could not be loaded: \$\{error\.message\}`\)\)/,
  'dashboard operations failure is surfaced without blocking secondary tabs');
assert.match(adminAuth, /const tasks = \[[\s\S]*?loadRelations\(\)[\s\S]*?loadAdminOps\(\)[\s\S]*?void withAdminLoading\('Loading the academic catalog and dashboard…', \(\) => Promise\.all\(tasks\)\)/,
  'initial catalog and dashboard requests run concurrently without delaying tab or deep-link activation');
assert.match(adminOps, /export async function loadAdminOps\(\) \{\s*const sections = new Set\(\['dashboard', \.\.\.loadedSections\]\)/,
  'admin operations startup refreshes the dashboard and only previously visited secondary sections');
assert.match(adminOps, /export async function loadAdminSection\(section, \{ refresh = false \} = \{\}\)[\s\S]*?section === 'audit'[\s\S]*?section === 'recycle'[\s\S]*?section === 'backup'[\s\S]*?section === 'health'[\s\S]*?section === 'transfer'/,
  'audit, recycle bin, backup, health, and import-stage data load on demand');
assert.match(adminOps, /activateAdminTab\(button\.dataset\.adminTab, cache\.adminRole\);\s*withAdminLoading\('Loading this administrator section…', \(\) => loadAdminSection\(button\.dataset\.adminTab\)\)/,
  'opening an admin tab starts its data load immediately');
assert.match(adminOps, /sectionRequestVersions\.set\(section, requestVersion\)[\s\S]*?sectionRequestVersions\.get\(section\) === requestVersion[\s\S]*?sectionRequestVersions\.get\(section\) !== requestVersion/,
  'older tab refresh responses cannot overwrite newer data');
assert.match(adminOps, /let auditRequestVersion = 0;[\s\S]*?const requestVersion = \+\+auditRequestVersion[\s\S]*?if \(requestVersion !== auditRequestVersion\) return;/,
  'rapid audit filter requests ignore stale responses');
assert.match(adminAuth, /const load = tab === 'requests' \? loadControlCenter\(getManagedUsers\(\)\) : tab === 'users' \? renderUsers\(\)/,
  'secondary support and user tabs fetch their data when opened');
assert.match(adminAuth, /let managedUsers = null;[\s\S]*?const getManagedUsers = async[\s\S]*?request\('\/admin\/users'\)[\s\S]*?if \(managedUsers === null \|\| refresh\) managedUsers = \(await getManagedUsers\(refresh\)\)\.users/,
  'the account list is deduplicated between users and request assignment data and reused for local filters');
assert.equal((adminAuth.match(/await refreshManagedUserViews\(\)/g) || []).length, 3,
  'account creation, updates, and password changes refresh managed-user views');
assert.match(adminAuth, /const refreshManagedUserViews = async \(\) => \{\s*await renderUsers\(null, true\);\s*if \(controlCenterLoaded\) await loadSupportPage\('complaints', cache\.supportPages\.complaints\);/,
  'account mutations refresh only the loaded complaints page whose assignment options changed');
const internalQuickActions = [...adminHtml.matchAll(/<button type="button" data-quick="([^"]+)">([\s\S]*?)<\/button>/g)].map((match) => [match[2].replace(/<svg[\s\S]*?<\/svg>/, '').replace(/<[^>]+>/g, '').trim(), match[1]]);
assert.deepEqual(internalQuickActions, [
  ['Add faculty', 'catalog'], ['Add program', 'catalog'], ['Add course', 'catalog'], ['Manage relations', 'catalog'],
  ['Import catalog', 'transfer'], ['Export catalog', 'transfer'], ['Create backup', 'backup'], ['Review audit logs', 'audit']
]);

console.log('Dashboard Quick Access route, refresh, active-state, and role-gate contracts passed.');
