function isPositiveInt(value) {
  return Number.isInteger(value) && value > 0;
}

function isPositiveIntArray(values) {
  return Array.isArray(values) && values.every((value) => isPositiveInt(value));
}

function optionalText(value, min = 1) {
  return value === undefined || value === null || (typeof value === 'string' && value.trim().length >= min);
}

export function validateEntityId(id, label = 'id') {
  if (!isPositiveInt(id)) return `Invalid ${label}`;
  return null;
}

export function validateFaculty(body) {
  if (!body || typeof body.name !== 'string' || body.name.trim().length < 2) return 'Invalid faculty name';
  return null;
}

export function validateFacultyPatch(body) {
  if (!body || !optionalText(body.name, 2)) return 'Invalid faculty name';
  return null;
}

export function validateProgram(body) {
  if (!isPositiveInt(body?.facultyId)) return 'Invalid facultyId';
  if (typeof body?.name !== 'string' || body.name.trim().length < 2) return 'Invalid program name';
  if (!isPositiveInt(body?.durationYears) || ![4, 5].includes(body.durationYears)) return 'Invalid durationYears';
  return null;
}

export function validateProgramPatch(body) {
  if (!body) return 'Invalid payload';
  if (body.facultyId !== undefined && !isPositiveInt(body.facultyId)) return 'Invalid facultyId';
  if (!optionalText(body.name, 2)) return 'Invalid program name';
  if (body.durationYears !== undefined && (!isPositiveInt(body.durationYears) || ![4, 5].includes(body.durationYears))) {
    return 'Invalid durationYears';
  }
  return null;
}

export function validateProgramCourse(body) {
  if (!isPositiveInt(body?.programId)) return 'Invalid programId';
  if (typeof body?.name !== 'string' || body.name.trim().length < 2) return 'Invalid name';
  if (typeof body?.code !== 'string' || body.code.trim().length < 1) return 'Invalid code';
  if (!isPositiveInt(body?.yearNo) || body.yearNo > 5) return 'Invalid yearNo';
  if (!isPositiveInt(body?.semesterNo) || body.semesterNo > 10) return 'Invalid semesterNo';
  if (!Number.isInteger(body?.credits) || body.credits < 0 || body.credits > 30) return 'Invalid credits';
  if (!optionalText(body.description, 0)) return 'Invalid description';
  if (body.isRequired !== undefined && typeof body.isRequired !== 'boolean') return 'Invalid isRequired';
  if (!isPositiveIntArray(body.prerequisiteCourseIds || [])) return 'Invalid prerequisiteCourseIds';
  return null;
}

export function validateProgramCoursePatch(body) {
  if (!body) return 'Invalid payload';
  if (body.programId !== undefined && !isPositiveInt(body.programId)) return 'Invalid programId';
  if (body.name !== undefined && (typeof body.name !== 'string' || body.name.trim().length < 2)) return 'Invalid name';
  if (body.code !== undefined && (typeof body.code !== 'string' || body.code.trim().length < 1)) return 'Invalid code';
  if (body.yearNo !== undefined && (!isPositiveInt(body.yearNo) || body.yearNo > 5)) return 'Invalid yearNo';
  if (body.semesterNo !== undefined && (!isPositiveInt(body.semesterNo) || body.semesterNo > 10)) return 'Invalid semesterNo';
  if (body.credits !== undefined && (!Number.isInteger(body.credits) || body.credits < 0 || body.credits > 30)) return 'Invalid credits';
  if (!optionalText(body.description, 0)) return 'Invalid description';
  if (body.isRequired !== undefined && typeof body.isRequired !== 'boolean') return 'Invalid isRequired';
  if (body.prerequisiteCourseIds !== undefined && !isPositiveIntArray(body.prerequisiteCourseIds)) return 'Invalid prerequisiteCourseIds';
  return null;
}

export function validatePrerequisites(body) {
  if (!body || !isPositiveIntArray(body.prerequisiteCourseIds || [])) return 'Invalid prerequisiteCourseIds';
  return null;
}
