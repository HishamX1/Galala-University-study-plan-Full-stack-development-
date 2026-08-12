function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : value;
}

function normalizePrerequisiteIds(value) {
  if (Array.isArray(value)) return value.map(toNumber);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed.split(/\s+/).map(toNumber) : [];
  }
  return [];
}

function normalizePrerequisiteRelations(value) {
  if (!Array.isArray(value)) return [];
  return value.map((relation) => ({
    ...relation,
    id: toNumber(relation.id),
    courseId: toNumber(relation.courseId),
    prerequisiteCourseId: toNumber(relation.prerequisiteCourseId),
    visibleToStudents: relation.visibleToStudents !== false
  }));
}

export function normalizeCatalog(catalog) {
  return {
    faculties: (catalog.faculties || []).map((faculty) => ({
      ...faculty,
      id: toNumber(faculty.id)
    })),
    programs: (catalog.programs || []).map((program) => ({
      ...program,
      id: toNumber(program.id),
      facultyId: toNumber(program.facultyId),
      durationYears: toNumber(program.durationYears)
    })),
    programCourses: (catalog.programCourses || []).map((course) => ({
      ...course,
      id: toNumber(course.id),
      programId: toNumber(course.programId),
      facultyId: toNumber(course.facultyId),
      courseId: toNumber(course.courseId),
      yearNo: toNumber(course.yearNo),
      semesterNo: toNumber(course.semesterNo),
      credits: toNumber(course.credits),
      prerequisiteCourseIds: normalizePrerequisiteIds(course.prerequisiteCourseIds),
      prerequisiteRelations: normalizePrerequisiteRelations(course.prerequisiteRelations)
    }))
  };
}
