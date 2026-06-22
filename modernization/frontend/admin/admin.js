import { setupLogin } from './modules/auth.js';
import { setupDialogs } from './modules/dialogs.js';
import { bindAdminActions, bindCrudDelegates } from './modules/forms.js';

setupDialogs();
bindAdminActions();
bindCrudDelegates();
setupLogin();
