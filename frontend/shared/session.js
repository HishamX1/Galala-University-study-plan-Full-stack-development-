import { getApiCandidates, saveApiBase } from './apiConfig.js';

const USER_CACHE_KEY = 'guAuthenticatedUser';
const SESSION_ROLES = new Set(['student', 'regular_admin', 'super_admin']);
let restoreInFlight = null;
let authStateGeneration = 0;
const SESSION_TIMEOUT_MS = 12_000;

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
async function performSignOut(landingPath) {
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
  const target = new URL(landingPath, location.href || 'http://localhost/');
  if (!revocationConfirmed) target.searchParams.set('logout', 'server-unconfirmed');
  if (overlay) overlay.hidden = true;
  location.replace(location.href ? target.href : `${target.pathname}${target.search}${target.hash}`);
}

export function signOut(landingPath = './index.html') {
  if (signOutInFlight) return signOutInFlight;
  const pending = performSignOut(landingPath);
  signOutInFlight = pending;
  const clearIfCurrent = () => { if (signOutInFlight === pending) signOutInFlight = null; };
  pending.then(clearIfCurrent, clearIfCurrent);
  return pending;
}
