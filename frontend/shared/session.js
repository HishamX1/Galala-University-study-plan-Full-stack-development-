import { getApiCandidates, saveApiBase } from './apiConfig.js';

const USER_CACHE_KEY = 'guAuthenticatedUser';
const SESSION_ROLES = new Set(['student', 'regular_admin', 'super_admin']);
let restoreInFlight = null;
let authStateGeneration = 0;
const SESSION_TIMEOUT_MS = 12_000;
export const IDLE_SESSION_TIMEOUT_MS = 300_000;
const LAST_ACTIVITY_KEY = 'guAuthLastActivity';
const SESSION_TIMEOUT_EVENT_KEY = 'guAuthSessionTimedOut';
let inactivitySession = null;

function timeoutHomeUrl(landingPath, role, expired = false, serverUnconfirmed = false) {
  const target = new URL(landingPath, location.href || 'http://localhost/');
  target.searchParams.set(expired ? 'sessionExpired' : 'sessionTimeout', role);
  if (serverUnconfirmed) target.searchParams.set('logout', 'server-unconfirmed');
  return location.href ? target.href : `${target.pathname}${target.search}${target.hash}`;
}

export function stopInactivityTimeout() {
  if (!inactivitySession) return;
  clearTimeout(inactivitySession.timer);
  for (const [target, type, listener, options] of inactivitySession.listeners) target.removeEventListener(type, listener, options);
  inactivitySession = null;
}

export function startInactivityTimeout(user, landingPath, idleMs = IDLE_SESSION_TIMEOUT_MS) {
  stopInactivityTimeout();
  if (!isValidSessionUser(user) || !Number.isFinite(idleMs) || idleMs <= 0) return () => {};
  let lastActivity = Date.now();
  try { localStorage.setItem(LAST_ACTIVITY_KEY, String(lastActivity)); } catch { /* Timer remains per-tab when storage is unavailable. */ }
  let lastPointerMove = 0;
  const session = { timer: null, listeners: [] };
  inactivitySession = session;

  const schedule = () => {
    clearTimeout(session.timer);
    session.timer = setTimeout(checkIdle, Math.max(0, idleMs - (Date.now() - lastActivity)));
  };
  const checkIdle = () => {
    try {
      const shared = Number(localStorage.getItem(LAST_ACTIVITY_KEY));
      if (Number.isFinite(shared) && shared > lastActivity) lastActivity = shared;
    } catch { /* Keep the in-memory activity timestamp. */ }
    if (Date.now() - lastActivity >= idleMs) {
      stopInactivityTimeout();
      void signOut(landingPath, { sessionTimeoutRole: user.role });
      return;
    }
    schedule();
  };
  const onActivity = (event) => {
    if (event?.type === 'pointermove') {
      const now = Date.now();
      if (now - lastPointerMove < 1000) return;
      lastPointerMove = now;
    }
    if (Date.now() - lastActivity >= idleMs) { checkIdle(); return; }
    lastActivity = Date.now();
    try { localStorage.setItem(LAST_ACTIVITY_KEY, String(lastActivity)); } catch { /* Timer remains per-tab when storage is unavailable. */ }
    schedule();
  };
  const onStorage = (event) => {
    if (event.key === LAST_ACTIVITY_KEY) {
      const shared = Number(event.newValue);
      if (Number.isFinite(shared) && shared > lastActivity) { lastActivity = shared; schedule(); }
      return;
    }
    if (event.key !== SESSION_TIMEOUT_EVENT_KEY || !event.newValue) return;
    try {
      const timeout = JSON.parse(event.newValue);
      if (!['student', 'regular_admin', 'super_admin'].includes(timeout.role) || !Number.isFinite(timeout.at)) return;
      stopInactivityTimeout();
      clearAuthenticatedState();
      location.replace(timeoutHomeUrl(landingPath, timeout.role, timeout.expired, timeout.serverUnconfirmed));
    } catch { /* Ignore malformed cross-tab messages. */ }
  };
  const activityOptions = { passive: true };
  for (const type of ['pointerdown', 'pointermove', 'keydown', 'input', 'click', 'touchstart', 'wheel']) {
    window.addEventListener(type, onActivity, activityOptions);
    session.listeners.push([window, type, onActivity, activityOptions]);
  }
  window.addEventListener('storage', onStorage);
  session.listeners.push([window, 'storage', onStorage]);
  document.addEventListener('visibilitychange', checkIdle);
  session.listeners.push([document, 'visibilitychange', checkIdle]);
  schedule();
  return stopInactivityTimeout;
}

export function clearAuthenticatedState() {
  authStateGeneration += 1;
  restoreInFlight = null;
  try { sessionStorage.removeItem(USER_CACHE_KEY); } catch { /* Storage can be unavailable in restricted browser contexts. */ }
}

function isValidSessionUser(user) {
  return Boolean(user && typeof user === 'object' && !Array.isArray(user)
    && (typeof user.id === 'string' || typeof user.id === 'number') && String(user.id)
    && SESSION_ROLES.has(user.role) && user.status === 'active');
}

async function restoreSessionForGeneration(generation) {
  let sawTransportFailure = false;
  for (const base of getApiCandidates()) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SESSION_TIMEOUT_MS);
    let refreshAttempted = false;
    try {
      const response = await fetch(`${base}/auth/me`, { credentials: 'include', headers: { Accept: 'application/json' }, signal: controller.signal });
      let user;
      if (response.status === 401) {
        refreshAttempted = true;
        const refresh = await fetch(`${base}/auth/refresh`, {
          method: 'POST', credentials: 'include', headers: { Accept: 'application/json' }, signal: controller.signal
        });
        if (!refresh.ok) {
          if (refresh.status >= 500) sawTransportFailure = true;
          break;
        }
        ({ user } = await refresh.json());
      } else if (response.ok) {
        ({ user } = await response.json());
      } else {
        if (response.status >= 500) sawTransportFailure = true;
        continue;
      }
      if (!isValidSessionUser(user)) continue;
      if (generation !== authStateGeneration) return null;
      saveApiBase(base);
      try { sessionStorage.setItem(USER_CACHE_KEY, JSON.stringify(user)); } catch { /* The backend remains authoritative if storage is unavailable. */ }
      return user;
    } catch { sawTransportFailure = true; if (refreshAttempted) break; /* A refresh rotation is never replayed at another origin. */ }
    finally { clearTimeout(timeout); }
  }
  if (generation === authStateGeneration && !sawTransportFailure) {
    try { sessionStorage.removeItem(USER_CACHE_KEY); } catch { /* Storage can be unavailable in restricted browser contexts. */ }
  }
  if (generation === authStateGeneration && sawTransportFailure) {
    try {
      const cached = JSON.parse(sessionStorage.getItem(USER_CACHE_KEY) || 'null');
      if (isValidSessionUser(cached)) return { unavailable: true, user: cached };
    } catch { /* Cached user state is advisory and can be discarded. */ }
    return { unavailable: true, user: null };
  }
  return null;
}

export function restoreSession() {
  if (restoreInFlight) return restoreInFlight;
  const generation = authStateGeneration;
  const pending = restoreSessionForGeneration(generation);
  restoreInFlight = pending;
  const clearIfCurrent = () => { if (restoreInFlight === pending) restoreInFlight = null; };
  pending.then(clearIfCurrent, clearIfCurrent);
  return pending;
}

export function portalPath(portal, from = '.') { return portal === 'student' ? `${from}/student/index.html` : `${from}/admin/index.html`; }

let signOutInFlight = null;
async function performSignOut(landingPath, options = {}) {
  stopInactivityTimeout();
  clearAuthenticatedState();
  const overlay = typeof document !== 'undefined' ? (document.getElementById?.('adminLoadingOverlay') || document.getElementById?.('dashboardLoadingOverlay') || document.getElementById?.('studentLoadingOverlay')) : null;
  const loadingLabel = typeof document !== 'undefined' ? (document.getElementById?.('adminLoadingMessage') || document.getElementById?.('dashboardLoadingMessage') || document.getElementById?.('studentLoadingMessage')) : null;
  if (overlay) { if (loadingLabel) loadingLabel.textContent = 'Signing out and revoking your session…'; overlay.hidden = false; }
  const buttons = typeof document !== 'undefined' && document.querySelectorAll ? [...document.querySelectorAll('#logoutBtn, #sign-out, #security-sign-out, #student-sign-out, #landing-sign-out')] : [];
  for (const button of buttons) { button.disabled = true; button.setAttribute('aria-busy', 'true'); }
  let revocationConfirmed = false;
  const base = getApiCandidates()[0];
  if (base) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch(`${base}/auth/logout`, { method: 'POST', credentials: 'include', signal: controller.signal });
      revocationConfirmed = response.ok || response.status === 204;
    } catch { /* Local sign-out proceeds; the query flag avoids claiming server revocation. */ }
    finally { clearTimeout(timeout); }
  }
  clearAuthenticatedState();
  const timeoutRole = options.sessionTimeoutRole || options.sessionExpiredRole;
  if (timeoutRole) {
    try { localStorage.setItem(SESSION_TIMEOUT_EVENT_KEY, JSON.stringify({ at: Date.now(), role: timeoutRole, expired: Boolean(options.sessionExpiredRole), serverUnconfirmed: !revocationConfirmed })); } catch { /* Current tab still receives a specific timeout message in the landing URL. */ }
  }
  if (overlay) overlay.hidden = true;
  location.replace(timeoutRole
    ? timeoutHomeUrl(landingPath, timeoutRole, Boolean(options.sessionExpiredRole), !revocationConfirmed)
    : (() => { const target = new URL(landingPath, location.href || 'http://localhost/'); if (!revocationConfirmed) target.searchParams.set('logout', 'server-unconfirmed'); return location.href ? target.href : `${target.pathname}${target.search}${target.hash}`; })());
}

export function signOut(landingPath = './index.html', options = {}) {
  if (signOutInFlight) return signOutInFlight;
  const pending = performSignOut(landingPath, options);
  signOutInFlight = pending;
  const clearIfCurrent = () => { if (signOutInFlight === pending) signOutInFlight = null; };
  pending.then(clearIfCurrent, clearIfCurrent);
  return pending;
}
