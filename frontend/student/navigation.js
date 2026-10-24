function numericId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function resolveProgramFacultyId(viewStack, catalog, fallbackFacultyId = '') {
  const facultyIds = new Set((catalog.faculties || []).map((faculty) => Number(faculty.id)));
  const programs = new Map((catalog.programs || []).map((program) => [Number(program.id), program]));

  for (const entry of [...(viewStack || [])].reverse()) {
    if (entry.view === 'faculty') {
      const facultyId = numericId(entry.facultyId);
      if (facultyId && facultyIds.has(facultyId)) return facultyId;
    }
    if (entry.view === 'program' || entry.view === 'courses') {
      const program = programs.get(numericId(entry.programId));
      if (program && facultyIds.has(Number(program.facultyId))) return Number(program.facultyId);
    }
  }

  const fallback = numericId(fallbackFacultyId);
  return fallback && facultyIds.has(fallback) ? fallback : null;
}

export function reconcileStudentViewStack(viewStack, catalog) {
  const facultyIds = new Set((catalog.faculties || []).map((faculty) => Number(faculty.id)));
  const programs = new Map((catalog.programs || []).map((program) => [Number(program.id), program]));
  const courses = catalog.programCourses || [];
  const result = [{ view: 'overview' }];

  for (const entry of (viewStack || []).slice(1)) {
    if (entry.view === 'faculty') {
      const facultyId = numericId(entry.facultyId);
      if (facultyId && facultyIds.has(facultyId)) result.splice(1, result.length - 1, { view: 'faculty', facultyId });
      continue;
    }

    if (entry.view === 'program' || entry.view === 'courses') {
      const programId = numericId(entry.programId);
      const program = programs.get(programId);
      if (!program || !facultyIds.has(Number(program.facultyId))) continue;
      const activeFaculty = [...result].reverse().find((item) => item.view === 'faculty');
      if (!activeFaculty || activeFaculty.facultyId !== Number(program.facultyId)) {
        result.splice(1, result.length - 1, { view: 'faculty', facultyId: Number(program.facultyId) });
      }
      const activeProgramIndex = result.map((item) => item.view).lastIndexOf('program');
      if (entry.view === 'program' && activeProgramIndex >= 0 && result[activeProgramIndex].programId !== programId) {
        result.splice(activeProgramIndex);
      }
      if (!result.some((item) => item.view === 'program' && item.programId === programId)) {
        result.push({ view: 'program', programId });
      }
      if (entry.view === 'courses') {
        const yearNo = numericId(entry.yearNo);
        const semesterNo = numericId(entry.semesterNo);
        const stillExists = yearNo && semesterNo && courses.some((course) => Number(course.programId) === programId
          && Number(course.yearNo) === yearNo && Number(course.semesterNo) === semesterNo);
        if (stillExists) result.push({ view: 'courses', programId, yearNo, semesterNo });
      }
    }
  }

  return result;
}
