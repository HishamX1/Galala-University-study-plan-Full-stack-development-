import { getApiCandidates, saveApiBase } from './apiConfig.js';

const USER_CACHE_KEY = 'guAuthenticatedUser';
export function clearAuthenticatedState() { sessionStorage.removeItem(USER_CACHE_KEY); }

export async function restoreSession() {
  for (const base of getApiCandidates()) {
    try {
      let response = await fetch(`${base}/auth/me`, { credentials: 'include' });
      if (response.status === 401) {
        const refresh = await fetch(`${base}/auth/refresh`, { method: 'POST', credentials: 'include' });
        if (!refresh.ok) continue;
        response = await fetch(`${base}/auth/me`, { credentials: 'include' });
      }
      if (response.ok) {
        const { user } = await response.json();
        saveApiBase(base);
        sessionStorage.setItem(USER_CACHE_KEY, JSON.stringify(user));
        return user;
      }
    } catch { /* Continue to the next configured API origin. */ }
  }
  clearAuthenticatedState();
  return null;
}

export function portalPath(portal, from = '.') { return portal === 'student' ? `${from}/student/index.html` : `${from}/admin/index.html`; }

export async function signOut(landingPath = './index.html') {
  for (const base of getApiCandidates()) {
    try {
      const response = await fetch(`${base}/auth/logout`, { method: 'POST', credentials: 'include' });
      if (response.ok || response.status === 204) break;
    } catch { /* Try the next configured API origin. */ }
  }
  clearAuthenticatedState();
  location.replace(landingPath);
}
