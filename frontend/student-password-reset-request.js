import { getApiCandidates, saveApiBase } from './shared/apiConfig.js';

const form = document.getElementById('student-reset-request-form');
const message = document.getElementById('student-reset-request-message');
const submitButton = form.querySelector('button[type="submit"]');
const genericResponse = 'If an active student account matches this email, a reset link will be sent to its registered address. If you do not receive it, contact Student Support. This response does not confirm whether an account exists.';

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  message.textContent = '';
  message.classList.remove('error');
  message.classList.add('status');
  submitButton.disabled = true;
  try {
    const email = String(new FormData(form).get('email') || '').trim();
    let lastNetworkError = null;
    for (const base of getApiCandidates()) {
      let response;
      try {
        response = await fetch(`${base}/auth/student-password-reset-requests`, {
          method: 'POST',
          credentials: 'omit',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ email })
        });
      } catch (error) {
        lastNetworkError = error;
        continue;
      }

      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Unable to process the request. Please try again later.');
      saveApiBase(base);
      message.textContent = data.message || genericResponse;
      form.reset();
      return;
    }
    throw new Error(lastNetworkError ? 'The service is temporarily unavailable. Please try again later.' : 'Unable to process the request. Please try again later.');
  } catch (error) {
    message.classList.remove('status');
    message.classList.add('error');
    message.textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});
