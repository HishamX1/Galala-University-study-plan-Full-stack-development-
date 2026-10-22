import { getApiCandidates, saveApiBase } from './shared/apiConfig.js';
const form = document.getElementById('reset-form'); const error = document.getElementById('reset-error');
const token = new URLSearchParams(location.search).get('token');
if (!token) {
  error.textContent = 'This password reset link is invalid. Request a new link to continue.';
  form.hidden = true;
}

form.addEventListener('submit', async (event) => { event.preventDefault(); error.textContent = ''; if (!token) { error.textContent = 'This password reset link is invalid. Request a new link to continue.'; return; } const values = Object.fromEntries(new FormData(form)); try { let last; for (const base of getApiCandidates()) { const response = await fetch(`${base}/auth/password-reset`, { method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ ...values, token }) }); if (response.ok) { saveApiBase(base); location.assign('student-login.html?passwordReset=success'); return; } last = new Error((await response.json().catch(() => ({}))).error || 'Unable to update password.'); } throw last; } catch (cause) { error.textContent = cause.message; } });
