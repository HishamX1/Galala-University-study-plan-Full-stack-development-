export const cache = {
  faculties: [],
  programs: [],
  programCourses: [],
  dashboard: null,
  auditLogs: [],
  recycleBin: [],
  backups: [],
  importStages: [],
  systemHealth: null,
  complaintAdmins: [],
  supportPages: { complaints: 0, communications: 0 },
  supportPageData: { complaints: null, communications: null },
  supportPageRequests: { complaints: 0, communications: 0 },
  adminRole: null,
  auditOffset: 0,
  courseSort: { key: 'code', direction: 'asc' }
};

export function lookupName(collection, id, key = 'name') {
  return collection.find((item) => Number(item.id) === Number(id))?.[key] ?? '-';
}
