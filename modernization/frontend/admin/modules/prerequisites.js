import { cache } from './state.js';

export function parsePrerequisiteCodes(raw) {
  return String(raw || '')
    .split(',')
    .map((code) => code.trim().toUpperCase())
    .filter(Boolean);
}

export function mapCodesToIds(codes) {
  const missing = [];
  const ids = [];
  for (const code of codes) {
    const course = cache.programCourses.find((item) => item.code.toUpperCase() === code);
    if (!course) missing.push(code);
    else ids.push(course.id);
  }
  if (missing.length) throw new Error(`Unknown prerequisite course code(s): ${missing.join(', ')}`);
  return [...new Set(ids)];
}

export function prerequisiteCodes(course) {
  return (course.prerequisiteCourseIds || [])
    .map((id) => cache.programCourses.find((item) => Number(item.id) === Number(id))?.code)
    .filter(Boolean)
    .join(', ');
}
