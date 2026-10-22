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

form.addEventListener('submit', async (event) => { event.preventDefault(); error.textContent = ''; if (!token) { error.textContent = 'This password reset link is invalid. Request a new link to continue.'; return; } const values = Object.fromEntries(new FormData(form)); try { let last; for (const base of getApiCandidates()) { const response = await fetch(`${base}/auth/password-reset`, { method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ ...values, token }) }); if (response.ok) { saveApiBase(base); form.hidden = true; error.hidden = true; success.textContent = 'Your password was updated successfully. Sign in with your new password.'; success.hidden = false; return; } last = new Error((await response.json().catch(() => ({}))).error || 'Unable to update password.'); } throw last; } catch (cause) { error.textContent = cause.message; } });
