export const cache = {
  faculties: [],
  programs: [],
  programCourses: []
};

export function lookupName(collection, id, key = 'name') {
  return collection.find((item) => Number(item.id) === Number(id))?.[key] ?? '-';
}
