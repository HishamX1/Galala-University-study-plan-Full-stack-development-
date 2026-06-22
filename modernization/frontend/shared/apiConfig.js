const API_STORAGE_KEY = 'guApiBase';

export function normalizeApiBase(value) {
  const trimmed = String(value || '').trim().replace(/\/$/, '');
  if (!trimmed) return '';
  return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
}

export function saveApiBase(value) {
  const normalized = normalizeApiBase(value);
  if (!normalized) return '';
  localStorage.setItem(API_STORAGE_KEY, normalized);
  return normalized;
}

export function getApiCandidates() {
  const configured = normalizeApiBase(
    window.__GU_API_BASE__ ||
    new URLSearchParams(window.location.search).get('apiBase') ||
    localStorage.getItem(API_STORAGE_KEY) ||
    document.querySelector('meta[name="gu-api-base"]')?.content ||
    ''
  );

  const candidates = [];
  if (configured) candidates.push(configured);

  const isBackendOrigin = window.location.origin.includes('localhost:4000') ||
    window.location.origin.includes('127.0.0.1:4000');

  if (isBackendOrigin) {
    candidates.push('/api');
  } else if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
    candidates.push(`${window.location.origin}/api`);
  }

  if (window.location.protocol !== 'https:') {
    candidates.push('http://127.0.0.1:4000/api');
    candidates.push('http://localhost:4000/api');
  }

  return [...new Set(candidates.filter(Boolean))];
}
