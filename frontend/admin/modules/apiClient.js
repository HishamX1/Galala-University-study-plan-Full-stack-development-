import { getApiCandidates, normalizeApiBase, saveApiBase } from '../../shared/apiConfig.js';

const apiCandidates = getApiCandidates();

let workingApiBase = apiCandidates[0];

export function getWorkingApiBase() {
  return workingApiBase;
}

export function updateConfiguredApiBase(value) {
  const normalized = normalizeApiBase(value);
  if (!normalized) return;
  workingApiBase = normalized;
  saveApiBase(normalized);
}

export async function request(path, options = {}) {
  let lastError = null;

  for (const base of [workingApiBase, ...apiCandidates.filter((candidate) => candidate !== workingApiBase)]) {
    try {
      let res = await fetch(`${base}${path}`, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        ...options
      });
      if (res.status === 401 && path !== '/auth/refresh') {
        const refreshed = await fetch(`${base}/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' }
        });
        if (refreshed.ok) {
          res = await fetch(`${base}${path}`, {
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            ...options
          });
        }
      }
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error('Modernization API is unavailable. Configure gu-api-base to your live backend.');
      }
      const data = await res.json();
      if (!res.ok) {
        const error = new Error(data.error || 'Request failed');
        if (res.status === 401) {
          window.location.assign('../admin-login.html');
          error.noRetry = true;
        }
        throw error;
      }
      workingApiBase = base;
      saveApiBase(base);
      return data;
    } catch (error) {
      if (error.noRetry) throw error;
      lastError = error;
    }
  }

  throw new Error(`Live API unavailable. Set a working API URL in "Live API Base URL". (${lastError?.message || 'Unknown error'})`);
}

export async function download(path) {
  let lastError = null;
  for (const base of [workingApiBase, ...apiCandidates.filter((candidate) => candidate !== workingApiBase)]) {
    try {
      const response = await fetch(`${base}${path}`, { credentials: 'include' });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Download failed');
      }
      const disposition = response.headers.get('content-disposition') || '';
      const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || 'download';
      workingApiBase = base;
      saveApiBase(base);
      return { filename, mimeType: response.headers.get('content-type') || 'application/octet-stream', content: await response.blob() };
    } catch (error) { lastError = error; }
  }
  throw new Error(`Download unavailable. (${lastError?.message || 'Unknown error'})`);
}
