import { getApiCandidates, saveApiBase } from './shared/apiConfig.js';
const form = document.getElementById('reset-form'); const error = document.getElementById('reset-error');
const success = document.getElementById('reset-success');
const params = new URLSearchParams(location.search);
const token = params.get('token');
const audience = params.get('audience');
const resetRequestLink = document.getElementById('reset-request-link');
if (audience === 'student') {
  resetRequestLink.href = 'student-password-reset-request.html';
  resetRequestLink.textContent = 'Request another student reset link';
} else if (audience === 'admin') {
  resetRequestLink.textContent = 'Request another administrator reset';
}
if (!token) {
  error.textContent = 'This password reset link is invalid. Request a new link to continue.';
  form.hidden = true;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault(); error.textContent = '';
  if (!token) { error.textContent = 'This password reset link is invalid. Request a new link to continue.'; return; }
  const button = form.querySelector('[type="submit"]');
  if (button?.disabled) return;
  if (button) button.disabled = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const base = getApiCandidates()[0];
    if (!base) throw new Error('The service is not configured.');
    const response = await fetch(`${base}/auth/password-reset`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...Object.fromEntries(new FormData(form)), token }), signal: controller.signal });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Unable to update password.');
    saveApiBase(base); form.hidden = true; error.hidden = true; success.textContent = 'Your password was updated successfully. Sign in with your new password.'; success.hidden = false;
  } catch (cause) { error.textContent = cause.name === 'AbortError' ? 'The request timed out. Check your connection; do not resubmit until you know whether the password was updated.' : cause instanceof TypeError ? 'The service is temporarily unavailable. The request was not automatically repeated.' : cause.message; }
  finally { clearTimeout(timeout); if (button) button.disabled = false; }
});
