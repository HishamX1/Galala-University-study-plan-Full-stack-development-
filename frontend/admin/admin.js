import { setupLogin } from './modules/auth.js';
import { setupDialogs } from './modules/dialogs.js';
import { bindAdminActions, bindCrudDelegates } from './modules/forms.js';
import { bindAdminOpsActions } from './modules/adminOps.js';

setupDialogs();
bindAdminOpsActions();
bindAdminActions();
bindCrudDelegates();
setupLogin();
