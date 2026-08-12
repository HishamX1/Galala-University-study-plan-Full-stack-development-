export const cache = {
  faculties: [],
  programs: [],
  programCourses: [],
  dashboard: null,
  auditLogs: [],
  recycleBin: [],
  backups: [],
  systemHealth: null,
  courseSort: { key: 'code', direction: 'asc' }
};

export function lookupName(collection, id, key = 'name') {
  return collection.find((item) => Number(item.id) === Number(id))?.[key] ?? '-';
}
