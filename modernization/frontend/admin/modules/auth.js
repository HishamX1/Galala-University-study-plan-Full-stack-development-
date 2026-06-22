import { getWorkingApiBase, request, updateConfiguredApiBase } from './apiClient.js';
import { elements, setMessage } from './adminDom.js';
import { loadRelations } from './dataLoader.js';

const ADMIN_USER = 'Admin';
const ADMIN_PASS = 'Admin';

export function setupLogin() {
  if (elements.apiBaseInput) {
    elements.apiBaseInput.value = getWorkingApiBase() || '';
    elements.apiBaseInput.addEventListener('change', () => {
      updateConfiguredApiBase(elements.apiBaseInput.value);
      elements.apiBaseInput.value = getWorkingApiBase();
    });
  }

  const onLogin = async () => {
    elements.authError.textContent = '';
    const username = elements.userInput.value.trim();
    const password = elements.passInput.value.trim();

    if (username !== ADMIN_USER || password !== ADMIN_PASS) {
      elements.authError.textContent = 'Invalid credentials. Use Admin/Admin.';
      return;
    }

    elements.loginCard.hidden = true;
    elements.dashboard.hidden = false;
    setMessage('success', 'Welcome admin');
    try {
      await request('/health');
      await loadRelations();
    } catch (error) {
      setMessage('error', error.message);
    }
  };

  elements.loginBtn.addEventListener('click', onLogin);
  elements.passInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') onLogin();
  });
}
