import { getApiCandidates, saveApiBase } from './shared/apiConfig.js';

const form = document.querySelector('form[data-auth-mode]');
const error = document.getElementById('auth-error');
const mode = form?.dataset.authMode;

document.getElementById('toggle-passwords')?.addEventListener('change', (event) => {
  document.querySelectorAll('input[name="password"], input[name="confirmPassword"]').forEach((input) => { input.type = event.target.checked ? 'text' : 'password'; });
});

form?.addEventListener('submit', async (event) => {
  event.preventDefault(); error.textContent = '';
  const values = Object.fromEntries(new FormData(form));
  const endpoint = mode === 'signup' ? '/auth/student-signup' : `/auth/${mode}-login`;
  try {
    let lastError;
    for (const base of getApiCandidates()) {
      try {
        const response = await fetch(`${base}${endpoint}`, { method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body:JSON.stringify(values) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Unable to sign in.');
        saveApiBase(base);
        location.assign('./dashboard.html'); return;
      } catch (cause) { lastError = cause; }
    }
    throw lastError || new Error('The service is unavailable.');
  } catch (cause) { error.textContent = cause.message; }
});
