import { byId } from '../../shared/dom.js';

export const elements = {
  error: byId('error'),
  success: byId('success'),
  progress: byId('progress'),
  authError: byId('authError'),
  apiBaseInput: byId('apiBaseUrl'),
  loginCard: byId('adminLoginCard'),
  dashboard: byId('adminDashboard'),
  userInput: byId('adminUsername'),
  passInput: byId('adminPassword'),
  loginBtn: byId('adminLoginBtn'),
  ids: {
    programFaculty: byId('programFaculty'),
    courseProgram: byId('courseProgram'),
    courseSearch: byId('courseSearch'),
    courseFilterFaculty: byId('courseFilterFaculty'),
    courseFilterProgram: byId('courseFilterProgram'),
    courseFilterYear: byId('courseFilterYear'),
    courseFilterSemester: byId('courseFilterSemester'),
    courseFilterRelations: byId('courseFilterRelations'),
    courseFilterVisibility: byId('courseFilterVisibility'),
    auditSearch: byId('auditSearch'),
    auditRange: byId('auditRange'),
    auditEntity: byId('auditEntity'),
    auditOrder: byId('auditOrder'),
    auditCategory: byId('auditCategory'),
    auditActor: byId('auditActor'),
    auditFrom: byId('auditFrom'),
    auditTo: byId('auditTo'),
    auditPrevious: byId('auditPrevious'),
    auditNext: byId('auditNext'),
    auditPage: byId('auditPage'),
    importType: byId('importType'),
    importFormat: byId('importFormat'),
    importContent: byId('importContent'),
    importFile: byId('importFile'),
    exportFormat: byId('exportFormat'),
    backupFormat: byId('backupFormat')
  },
  lists: {
    faculties: byId('facultyList'),
    programs: byId('programList'),
    courses: byId('courseList'),
    metricCards: byId('metricCards'),
    analyticsCards: byId('analyticsCards'),
    activityList: byId('activityList'),
    auditLogs: byId('auditLogList'),
    recycleBin: byId('recycleBinList'),
    importPreview: byId('importPreview'),
    importStages: byId('importStages'),
    backupList: byId('backupList'),
    healthList: byId('healthList')
  },
  dialog: {
    backdrop: byId('adminDialogBackdrop'),
    form: byId('adminDialogForm'),
    title: byId('adminDialogTitle'),
    description: byId('adminDialogDescription'),
    fields: byId('adminDialogFields'),
    submit: byId('adminDialogSubmit'),
    cancel: byId('adminDialogCancel'),
    close: byId('adminDialogClose')
  }
};

export function setMessage(type, message) {
  elements.error.textContent = type === 'error' ? message : '';
  elements.success.textContent = type === 'success' ? message : '';
  if (elements.progress) {
    elements.progress.textContent = type === 'progress' ? message : '';
    elements.progress.hidden = type !== 'progress';
  }
  if (type === 'error' && message) {
    const remembered = typeof window !== 'undefined' && window.__GU_LAST_API_ERROR__?.message === message ? window.__GU_LAST_API_ERROR__ : null;
    showAdminError(message, remembered);
  } else if (typeof window !== 'undefined') window.__GU_LAST_API_ERROR__ = null;
}

let currentAdminError = null;
let lastErrorSignature = '';
let lastErrorTime = 0;
export function showAdminError(message, error = null) {
  const dialog = document.getElementById('adminErrorDialog');
  if (!dialog) return;
  const signature = `${error?.code || ''}:${error?.status || ''}:${message}`;
  if (signature === lastErrorSignature && Date.now() - lastErrorTime < 3000) return;
  lastErrorSignature = signature;
  lastErrorTime = Date.now();
  currentAdminError = error || { message };
  document.getElementById('adminErrorMessage').textContent = message;
  document.getElementById('adminErrorOperation').textContent = error?.operation || (error?.method && error?.endpoint ? `${error.method} ${error.endpoint}` : 'Administrator action');
  document.getElementById('adminErrorCode').textContent = [error?.status && `HTTP ${error.status}`, error?.code].filter(Boolean).join(' · ') || 'No server error code was provided';
  document.getElementById('adminErrorRequestId').textContent = error?.requestId || 'Not available';
  document.getElementById('adminErrorTimestamp').textContent = new Date().toISOString();
  document.getElementById('adminErrorEndpoint').textContent = error?.endpoint || 'Not available';
  const details = document.getElementById('adminErrorTechnicalDetails');
  details.textContent = JSON.stringify({ code: error?.code || null, status: error?.status || null, requestId: error?.requestId || null, endpoint: error?.endpoint || null }, null, 2);
  if (!dialog.open) dialog.showModal();
}

if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('click', async (event) => {
  const close = event.target.closest('[data-admin-error-close]');
  if (close) document.getElementById('adminErrorDialog')?.close();
  const reportButton = event.target.closest('[data-admin-error-report]');
  if (!reportButton || !currentAdminError) return;
  reportButton.disabled = true;
  try {
    const { request } = await import('./apiClient.js');
    const error = currentAdminError;
    const category = error.category || (error.code === 'API_NETWORK_ERROR' || error.code === 'REQUEST_TIMEOUT' ? 'network'
      : error.endpoint?.includes('/auth/') ? 'authentication'
        : error.endpoint?.includes('/import') ? 'import'
          : error.endpoint?.includes('catalog') || error.endpoint?.includes('program-courses') ? 'catalog' : 'api');
    const response = await request('/admin/error-reports', { method: 'POST', body: JSON.stringify({
      category, severity: error.status >= 500 ? 'high' : 'medium',
      message: String(error.message || 'Administrator reported an error').slice(0, 900),
      requestId: error.requestId, page: location.pathname, endpoint: error.endpoint || '', method: error.method || '',
      technicalDetails: { code: error.code || '', status: error.status || '', requestId: error.requestId || '', timestamp: new Date().toISOString(), page: location.pathname, endpoint: error.endpoint || '', method: error.method || '' }
    }) });
    document.getElementById('adminErrorReportResult').textContent = `Report ${response.report.id} was submitted to the Super Admin.`;
  } catch {
    document.getElementById('adminErrorReportResult').textContent = 'Online submission failed. The report was not delivered to the Super Admin. Check your connection and try again.';
  } finally { reportButton.disabled = false; }
});

if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('error', () => showAdminError('An unexpected error occurred in the administrator interface. Reload the page and try again.', { code: 'FRONTEND_UNEXPECTED' }));
  window.addEventListener('unhandledrejection', () => showAdminError('An unexpected administrator operation failed. Reload the page and try again.', { code: 'FRONTEND_REJECTION' }));
}

export async function withButtonBusy(button, operation) {
  if (!button || button.disabled) return;
  const wasDisabled = button.disabled;
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  try {
    return await operation();
  } finally {
    button.disabled = wasDisabled;
    button.removeAttribute('aria-busy');
    if (button.isConnected && !button.closest('[hidden]')) button.focus();
    if (elements.progress) {
      elements.progress.textContent = '';
      elements.progress.hidden = true;
    }
  }
}

let adminLoadingCount = 0;
export async function withAdminLoading(message, operation) {
  const overlay = document.getElementById('adminLoadingOverlay');
  const label = document.getElementById('adminLoadingMessage');
  if (!overlay) return operation();
  label.textContent = message;
  adminLoadingCount += 1;
  overlay.hidden = false;
  try { return await operation(); }
  finally { adminLoadingCount = Math.max(0, adminLoadingCount - 1); overlay.hidden = adminLoadingCount > 0; }
}
