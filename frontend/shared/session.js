import { getApiCandidates, saveApiBase } from './apiConfig.js';

const USER_CACHE_KEY = 'guAuthenticatedUser';
const SESSION_ROLES = new Set(['student', 'regular_admin', 'super_admin']);
let restoreInFlight = null;
let authStateGeneration = 0;

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
  for (const base of getApiCandidates()) {
    try {
      const response = await fetch(`${base}/auth/me`, { credentials: 'include', headers: { Accept: 'application/json' } });
      let user;
      if (response.status === 401) {
        const refresh = await fetch(`${base}/auth/refresh`, {
          method: 'POST', credentials: 'include', headers: { Accept: 'application/json' }
        });
        if (!refresh.ok) continue;
        ({ user } = await refresh.json());
      } else if (response.ok) {
        ({ user } = await response.json());
      } else {
        continue;
      }
      if (!isValidSessionUser(user)) continue;
      if (generation !== authStateGeneration) return null;
      saveApiBase(base);
      try { sessionStorage.setItem(USER_CACHE_KEY, JSON.stringify(user)); } catch { /* The backend remains authoritative if storage is unavailable. */ }
      return user;
    } catch { /* Continue to the next configured API origin. */ }
  }
  if (generation === authStateGeneration) {
    try { sessionStorage.removeItem(USER_CACHE_KEY); } catch { /* Storage can be unavailable in restricted browser contexts. */ }
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

export async function signOut(landingPath = './index.html') {
  clearAuthenticatedState();
  for (const base of getApiCandidates()) {
    try {
      const response = await fetch(`${base}/auth/logout`, { method: 'POST', credentials: 'include' });
      if (response.ok || response.status === 204) break;
    } catch { /* Try the next configured API origin. */ }
  }
  clearAuthenticatedState();
  location.replace(landingPath);
}
