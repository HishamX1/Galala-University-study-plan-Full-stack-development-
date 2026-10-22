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
  ['Course Manager', '../admin/index.html?tab=catalog'], ['Add Course', '../admin/index.html?tab=catalog'],
  ['Manage Relations', '../admin/index.html?tab=catalog'], ['Import', '../admin/index.html?tab=transfer'],
  ['Program Management', '../admin/index.html?tab=catalog'], ['Faculty Management', '../admin/index.html?tab=catalog']
]);
assert.deepEqual(adminQuickAccessActions('super_admin', '../admin/index.html', '../student/index.html'), [
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
assert.match(adminAuth, /await openRequestedAdminDestination\(user\.role\)/);
assert.equal((adminAuth.match(/await loadInitialAdminData\(user\.role\)/g) || []).length, 2,
  'login and session restoration use the shared concurrent workspace initializer');
assert.match(adminAuth, /const userDataPromise = request\('\/admin\/users'\);[\s\S]*?renderUsers\(users\)[\s\S]*?loadControlCenter\(userDataPromise\)/,
  'super-admin account rendering and request assignment reuse one user-list request');
assert.match(adminAuth, /let managedUsers = null;[\s\S]*?if \(managedUsers === null \|\| refresh\) managedUsers = \(await request\('\/admin\/users'\)\)\.users;/,
  'user search and filters render from the in-memory list instead of refetching each keystroke');
assert.equal((adminAuth.match(/await renderUsers\(null, true\)/g) || []).length, 3,
  'user list refreshes after create, account updates, and password changes');
const internalQuickActions = [...adminHtml.matchAll(/<button type="button" data-quick="([^"]+)">([\s\S]*?)<\/button>/g)].map((match) => [match[2].replace(/<svg[\s\S]*?<\/svg>/, '').replace(/<[^>]+>/g, '').trim(), match[1]]);
assert.deepEqual(internalQuickActions, [
  ['Add faculty', 'catalog'], ['Add program', 'catalog'], ['Add course', 'catalog'], ['Manage relations', 'catalog'],
  ['Import catalog', 'transfer'], ['Export catalog', 'transfer'], ['Create backup', 'backup'], ['Review audit logs', 'audit']
]);

console.log('Dashboard Quick Access route, refresh, active-state, and role-gate contracts passed.');
