import { getApiCandidates, saveApiBase } from './shared/apiConfig.js';

const form = document.getElementById('request-form');
const message = document.getElementById('request-message');
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = form.querySelector('[type="submit"]');
  if (button?.disabled) return;
  if (button) button.disabled = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const base = getApiCandidates()[0];
    if (!base) throw new Error('The service is not configured.');
    const response = await fetch(`${base}/auth/password-reset-requests`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(form))), signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Unable to submit your request.');
    saveApiBase(base);
    message.textContent = data.message || 'Your request was submitted.';
    form.reset();
  } catch (error) {
    message.textContent = error.name === 'AbortError' ? 'The request timed out. Check your connection; it was not automatically resubmitted.' : error instanceof TypeError ? 'The service is temporarily unavailable. The request was not automatically resubmitted.' : error.message;
  } finally { clearTimeout(timeout); if (button) button.disabled = false; }
});
