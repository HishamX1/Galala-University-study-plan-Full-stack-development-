import { getApiCandidates, normalizeApiBase, saveApiBase } from '../../shared/apiConfig.js';

const apiCandidates = getApiCandidates();
const REQUEST_TIMEOUT_MS = 15_000;

let workingApiBase = apiCandidates[0];
let refreshInFlight = null;

function refreshAdminSession(base) {
  if (!refreshInFlight) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const pending = fetch(`${base}/auth/refresh`, {
      method: 'POST', credentials: 'include',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, signal: controller.signal
    }).then(async (response) => ({ response, data: await response.json().catch(() => ({})) }))
      .finally(() => { clearTimeout(timeout); if (refreshInFlight === pending) refreshInFlight = null; });
    refreshInFlight = pending;
  }
  return refreshInFlight;
}

export function getWorkingApiBase() {
  return workingApiBase;
}

export function updateConfiguredApiBase(value) {
  const normalized = normalizeApiBase(value);
  if (!normalized) throw new Error('Enter a valid http(s) API URL without credentials, query parameters, or a fragment.');
  workingApiBase = normalized;
}

export async function request(path, options = {}) {
  if (!workingApiBase) throw new Error('API is not configured. Check the API base URL setting.');
  const base = workingApiBase;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), REQUEST_TIMEOUT_MS);
  try {
      let res = await fetch(`${base}${path}`, {
        credentials: 'include',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        signal: controller.signal,
        ...options
      });
      if (res.status === 401 && path !== '/auth/refresh') {
        const { response: refreshed, data: refreshedData } = await refreshAdminSession(base);
        if (refreshed.ok) {
          if (path === '/auth/me') {
            workingApiBase = base;
            saveApiBase(base);
            return refreshedData;
          }
          const method = String(options.method || 'GET').toUpperCase();
          if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
            const error = new Error('Your session was refreshed, but the operation was not repeated. Review its status before submitting it again.');
            error.status = 401;
            error.code = 'AUTH_REFRESHED_OPERATION_NOT_REPLAYED';
            error.noRetry = true;
            throw error;
          }
          res = await fetch(`${base}${path}`, {
            credentials: 'include',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
            signal: controller.signal,
            ...options
          });
        } else if (refreshed.status === 401) {
          const error = new Error('Your session has expired. Please sign in again.');
          error.status = 401;
          error.code = 'SESSION_EXPIRED';
          error.definitiveAuthFailure = true;
          error.noRetry = true;
          window.location.assign('../admin-login.html');
          throw error;
        } else if (refreshed.status >= 500) {
          const error = new Error('The authentication service is temporarily unavailable.');
          error.status = refreshed.status;
          error.code = 'AUTH_SERVICE_UNAVAILABLE';
          error.noRetry = true;
          throw error;
        } else {
          const error = new Error('The session could not be refreshed because the server rejected the request.');
          error.status = refreshed.status;
          error.code = refreshed.status === 403 ? 'AUTH_REFRESH_FORBIDDEN' : 'AUTH_REFRESH_FAILED';
          error.noRetry = true;
          throw error;
        }
      }
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        const error = new Error('The API returned an unexpected response. Check the API URL and server status.');
        error.code = 'INVALID_API_RESPONSE';
        error.status = res.status;
        error.noRetry = true;
        throw error;
      }
      const data = await res.json();
      if (!res.ok) {
        const error = new Error(data.error || 'Request failed');
        error.status = res.status;
        error.code = data.code;
        error.requestId = data.requestId || res.headers.get('x-request-id') || '';
        error.data = data;
        if (data.code === 'STALE_WRITE') error.noRetry = true;
        if (path.startsWith('/admin/import') && [409, 410, 422, 429].includes(res.status)) error.noRetry = true;
        if (res.status === 401 && path === '/auth/refresh') {
          window.location.assign('../admin-login.html');
          error.noRetry = true;
        }
        throw error;
      }
      workingApiBase = base;
      saveApiBase(base);
      return data;
  } catch (error) {
    if (error && typeof error === 'object') {
      error.endpoint ||= path;
      error.method ||= String(options.method || 'GET').toUpperCase();
    }
    if (controller.signal.aborted || error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      const timeoutError = new Error('The API request timed out. Check your connection and try again.');
      timeoutError.code = 'REQUEST_TIMEOUT';
      timeoutError.endpoint = path;
      timeoutError.method = String(options.method || 'GET').toUpperCase();
      timeoutError.cause = error;
      if (typeof window !== 'undefined') window.__GU_LAST_API_ERROR__ = timeoutError;
      throw timeoutError;
    }
    if (error instanceof TypeError) {
      const networkError = new Error('Could not reach the API. Check your connection, API URL, CORS settings, or browser security policy.');
      networkError.code = 'API_NETWORK_ERROR';
      networkError.endpoint = path;
      networkError.method = String(options.method || 'GET').toUpperCase();
      networkError.cause = error;
      if (typeof window !== 'undefined') window.__GU_LAST_API_ERROR__ = networkError;
      throw networkError;
    }
    if (typeof window !== 'undefined') window.__GU_LAST_API_ERROR__ = error;
    throw error;
  } finally {
    clearTimeout(timeout);
  }
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
