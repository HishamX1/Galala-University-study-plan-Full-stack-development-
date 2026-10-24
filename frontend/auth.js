import { getApiCandidates, saveApiBase } from './shared/apiConfig.js';

const form = document.querySelector('form[data-auth-mode]');
const error = document.getElementById('auth-error');
const status = document.getElementById('auth-status');
const mode = form?.dataset.authMode;

if (mode === 'student' && new URLSearchParams(location.search).get('passwordReset') === 'success' && status) {
  status.textContent = 'Your password was updated successfully. Sign in with your new password.';
  status.hidden = false;
}

document.getElementById('toggle-passwords')?.addEventListener('change', (event) => {
  document.querySelectorAll('input[name="password"], input[name="confirmPassword"]').forEach((input) => { input.type = event.target.checked ? 'text' : 'password'; });
});

form?.addEventListener('submit', async (event) => {
  event.preventDefault(); error.textContent = '';
  const submit = form.querySelector('[type="submit"]');
  if (submit?.disabled) return;
  const originalLabel = submit?.textContent || '';
  if (submit) { submit.disabled = true; submit.setAttribute('aria-busy', 'true'); submit.textContent = mode === 'signup' ? 'Creating account…' : 'Signing in…'; }
  if (status) { status.hidden = false; status.textContent = mode === 'signup' ? 'Creating your account…' : 'Checking your account…'; }
  const values = Object.fromEntries(new FormData(form));
  const endpoint = mode === 'signup' ? '/auth/student-signup' : `/auth/${mode}-login`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const base = getApiCandidates()[0];
    if (!base) throw new Error('The API is not configured.');
    const response = await fetch(`${base}${endpoint}`, { method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body:JSON.stringify(values), signal:controller.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { const cause = new Error(data.error || 'Unable to sign in.'); cause.status = response.status; cause.code = data.code; cause.requestId = data.requestId || response.headers.get('x-request-id'); throw cause; }
    saveApiBase(base);
    location.assign('./dashboard.html');
  } catch (cause) {
    error.textContent = controller.signal.aborted ? 'The sign-in request timed out. Check your connection and try again.' : cause instanceof TypeError ? 'Could not reach the API. Check your connection or service availability.' : cause.message;
    if (status) { status.hidden = true; status.textContent = ''; }
  } finally {
    clearTimeout(timeout);
    if (submit) { submit.disabled = false; submit.removeAttribute('aria-busy'); submit.textContent = originalLabel; }
  }
});
