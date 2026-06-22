import { byId } from '../../shared/dom.js';

export const elements = {
  error: byId('error'),
  success: byId('success'),
  authError: byId('authError'),
  apiBaseInput: byId('apiBaseUrl'),
  loginCard: byId('adminLoginCard'),
  dashboard: byId('adminDashboard'),
  userInput: byId('adminUsername'),
  passInput: byId('adminPassword'),
  loginBtn: byId('adminLoginBtn'),
  ids: {
    programFaculty: byId('programFaculty'),
    courseProgram: byId('courseProgram')
  },
  lists: {
    faculties: byId('facultyList'),
    programs: byId('programList'),
    courses: byId('courseList')
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
}
