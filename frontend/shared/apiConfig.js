const API_STORAGE_KEY = 'guApiBase';
export const PRODUCTION_API_BASE = 'https://galala-university-study-plan-full-stack-kd69.onrender.com/api';

export function normalizeApiBase(value) {
  const trimmed = String(value || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  let parsed;
  try { parsed = new URL(trimmed); } catch { return ''; }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) return '';
  const path = parsed.pathname.replace(/\/+$/, '');
  parsed.pathname = path.endsWith('/api') ? path : `${path}/api`;
  return parsed.toString().replace(/\/$/, '');
}

export function saveApiBase(value) {
  const normalized = normalizeApiBase(value);
  if (!normalized) return '';
  try { localStorage.setItem(API_STORAGE_KEY, normalized); } catch { /* Diagnostic overrides are optional. */ }
  return normalized;
}

export function getApiCandidates() {
  let stored = '';
  try { stored = localStorage.getItem(API_STORAGE_KEY) || ''; } catch { /* Storage is optional. */ }
  const queryOverride = new URLSearchParams(window.location.search).get('apiBase');
  const configured = normalizeApiBase(queryOverride) ||
    normalizeApiBase(window.__GU_API_BASE__) ||
    normalizeApiBase(stored) ||
    normalizeApiBase(document.querySelector('meta[name="gu-api-base"]')?.content || '');

  const candidates = [];
  if (configured) candidates.push(configured);

  const isLocalHost = window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1';
  const isBackendOrigin = isLocalHost && window.location.port === '4000';

  if (normalizeApiBase(queryOverride)) {
    // Explicit diagnostic target: use only this origin for the current page.
  } else if (isBackendOrigin) {
    candidates.push('/api');
  } else if (isLocalHost) {
    candidates.push(`http://${window.location.hostname}:4000/api`);
  } else if (!configured && (window.location.protocol === 'http:' || window.location.protocol === 'https:')) {
    candidates.push(PRODUCTION_API_BASE);
  }

  if (window.location.protocol !== 'https:') {
    candidates.push('http://127.0.0.1:4000/api');
    candidates.push('http://localhost:4000/api');
  }

  return [...new Set(candidates.filter(Boolean))];
}
