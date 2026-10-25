// Authorization is enforced on the server. UI visibility is only a convenience.
export const Permissions = Object.freeze({
  catalogRead: 'catalog.read', catalogWrite: 'catalog.write', catalogImport: 'catalog.import', catalogExport: 'catalog.export',
  usersRead: 'users.read', usersWrite: 'users.write', usersSuspend: 'users.suspend', usersDelete: 'users.delete',
  auditRead: 'audit.read', backupRun: 'backup.run', systemRead: 'system.read', recoveryManage: 'recovery.manage',
  complaintsManage: 'complaints.manage', academicProgress: 'academic_progress.own', errorReportCreate: 'error_reports.create', errorReportsRead: 'error_reports.read',
  errorReportsManage: 'error_reports.manage', dashboardRead: 'dashboard.read', profileWrite: 'profile.write', studentComplaintCreate: 'complaints.create'
});

const all = Object.freeze(Object.values(Permissions));
export const rolePermissions = Object.freeze({
  student: Object.freeze([Permissions.catalogRead, Permissions.dashboardRead, Permissions.profileWrite, Permissions.studentComplaintCreate, Permissions.academicProgress]),
  // `regular_admin` is the persisted compatibility role. Do not rename it without a migration.
  regular_admin: Object.freeze([Permissions.catalogRead, Permissions.catalogWrite, Permissions.catalogImport, Permissions.catalogExport, Permissions.dashboardRead, Permissions.profileWrite, Permissions.auditRead, Permissions.backupRun, Permissions.errorReportCreate]),
  super_admin: all
});

export function hasPermission(user, permission) {
  return Boolean(user && rolePermissions[user.role]?.includes(permission));
}

export function requirePermission(user, permission) {
  return hasPermission(user, permission);
}
