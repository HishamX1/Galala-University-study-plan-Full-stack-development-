export const ADMIN_TAB_ROLES = Object.freeze({
  dashboard: Object.freeze(['regular_admin', 'super_admin']),
  catalog: Object.freeze(['regular_admin', 'super_admin']),
  audit: Object.freeze(['regular_admin', 'super_admin']),
  transfer: Object.freeze(['regular_admin', 'super_admin']),
  backup: Object.freeze(['regular_admin', 'super_admin']),
  recycle: Object.freeze(['super_admin']),
  health: Object.freeze(['super_admin']),
  users: Object.freeze(['super_admin']),
  requests: Object.freeze(['super_admin'])
});

export function canAccessAdminTab(tab, role) {
  return Boolean(ADMIN_TAB_ROLES[tab]?.includes(role));
}

export function resolveAdminTab(tab, role) {
  if (!tab) return { allowed: true, tab: null };
  if (!Object.hasOwn(ADMIN_TAB_ROLES, tab)) return { allowed: false, reason: 'unknown' };
  if (!canAccessAdminTab(tab, role)) return { allowed: false, reason: 'forbidden' };
  return { allowed: true, tab };
}

export function adminTabHref(tab, adminIndexHref = './admin/index.html') {
  if (!Object.hasOwn(ADMIN_TAB_ROLES, tab)) return null;
  return `${adminIndexHref}?${new URLSearchParams({ tab })}`;
}

export function adminQuickAccessActions(role, adminIndexHref = './admin/index.html', studentPortalHref = './student/index.html') {
  if (role === 'regular_admin') return [
    ['Course Manager', adminTabHref('catalog', adminIndexHref)],
    ['Add Course', adminTabHref('catalog', adminIndexHref)],
    ['Manage Relations', adminTabHref('catalog', adminIndexHref)],
    ['Import', adminTabHref('transfer', adminIndexHref)],
    ['Program Management', adminTabHref('catalog', adminIndexHref)],
    ['Faculty Management', adminTabHref('catalog', adminIndexHref)]
  ];
  if (role === 'super_admin') return [
    ['User Management', adminTabHref('users', adminIndexHref)],
    ['Requests & Complaints', adminTabHref('requests', adminIndexHref)],
    ['Audit Logs', adminTabHref('audit', adminIndexHref)],
    ['Backup', adminTabHref('backup', adminIndexHref)],
    ['Export', adminTabHref('transfer', adminIndexHref)],
    ['Recycle Bin', adminTabHref('recycle', adminIndexHref)],
    ['System Health', adminTabHref('health', adminIndexHref)],
    ['Student Portal', studentPortalHref],
    ['Admin Portal', adminTabHref('dashboard', adminIndexHref)]
  ];
  return null;
}

export function activateAdminTab(tab, role, documentRef = document, windowRef = window, { updateUrl = true } = {}) {
  if (!canAccessAdminTab(tab, role)) return false;
  const buttons = [...documentRef.querySelectorAll('[data-admin-tab]')];
  const button = buttons.find((candidate) => candidate.dataset.adminTab === tab && !candidate.hidden && !candidate.disabled);
  const panel = [...documentRef.querySelectorAll('[data-admin-panel]')].find((candidate) => candidate.dataset.adminPanel === tab);
  if (!button || !panel) return false;

  for (const candidate of buttons) {
    const selected = candidate === button;
    candidate.classList.toggle('is-active', selected);
    if (selected) candidate.setAttribute('aria-current', 'page');
    else candidate.removeAttribute('aria-current');
  }
  for (const candidate of documentRef.querySelectorAll('[data-admin-panel]')) candidate.hidden = candidate !== panel;

  if (updateUrl && windowRef?.history?.replaceState && windowRef?.location?.href) {
    const url = new URL(windowRef.location.href);
    url.searchParams.set('tab', tab);
    if (tab !== 'requests') {
      url.searchParams.delete('complaint');
      url.searchParams.delete('resetRequest');
    }
    windowRef.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }
  return true;
}
