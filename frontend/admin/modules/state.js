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
  adminRole: null,
  auditOffset: 0,
  courseSort: { key: 'code', direction: 'asc' }
};

export function lookupName(collection, id, key = 'name') {
  return collection.find((item) => Number(item.id) === Number(id))?.[key] ?? '-';
}
