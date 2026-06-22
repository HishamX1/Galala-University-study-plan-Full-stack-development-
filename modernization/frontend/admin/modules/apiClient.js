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
      const res = await fetch(`${base}${path}`, {
        headers: { 'Content-Type': 'application/json' },
        ...options
      });
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error('Modernization API is unavailable. Configure gu-api-base to your live backend.');
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      workingApiBase = base;
      saveApiBase(base);
      return data;
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(`Live API unavailable. Set a working API URL in "Live API Base URL". (${lastError?.message || 'Unknown error'})`);
}
