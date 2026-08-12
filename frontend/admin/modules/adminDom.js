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
}
