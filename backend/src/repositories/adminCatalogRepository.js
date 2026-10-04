export async function readCatalogSnapshot(executor) {
  const [faculties, programs, courses, relations] = await Promise.all([
    executor.query('SELECT id, name, created_at, updated_at FROM faculties WHERE deleted_at IS NULL ORDER BY name'),
    executor.query('SELECT id, faculty_id, name, duration_years, created_at, updated_at FROM programs WHERE deleted_at IS NULL ORDER BY name'),
    executor.query(`SELECT pc.id, pc.program_id, p.faculty_id, pc.course_id, pc.code, c.name, pc.year_no, pc.semester_no,
              pc.credits, pc.is_required, c.description, pc.created_at, pc.updated_at
         FROM program_courses pc
         JOIN programs p ON p.id = pc.program_id AND p.deleted_at IS NULL
         JOIN courses c ON c.id = pc.course_id AND c.deleted_at IS NULL
        WHERE pc.deleted_at IS NULL
        ORDER BY pc.program_id, pc.year_no, pc.semester_no, pc.code`),
    executor.query(`SELECT id, course_id, prerequisite_course_id, visible_to_students, created_at, updated_at
         FROM course_prerequisites
        WHERE deleted_at IS NULL
        ORDER BY course_id, prerequisite_course_id`)
  ]);
  return { faculties: faculties.rows, programs: programs.rows, programCourses: courses.rows, relationships: relations.rows };
}

export async function readImportReferences(executor) {
  return Promise.all([
    executor.query('SELECT id, lower(name) AS name FROM faculties WHERE deleted_at IS NULL'),
    executor.query('SELECT id, faculty_id, lower(name) AS name FROM programs WHERE deleted_at IS NULL'),
    executor.query(`SELECT pc.id, pc.program_id, lower(pc.code) AS code, lower(c.name) AS name
         FROM program_courses pc
         JOIN courses c ON c.id = pc.course_id AND c.deleted_at IS NULL
        WHERE pc.deleted_at IS NULL`)
  ]);
}

export async function insertImportedRow(executor, type, row) {
  if (type === 'faculties') {
    await executor.query('INSERT INTO faculties (name) VALUES ($1) ON CONFLICT DO NOTHING', [String(row.name).trim()]);
    return;
  }
  if (type === 'programs') {
    await executor.query(`INSERT INTO programs (faculty_id, name, duration_years)
      VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [Number(row.facultyId ?? row.faculty_id), String(row.name).trim(), Number(row.durationYears ?? row.duration_years)]);
    return;
  }
  if (type === 'programCourses') {
    const course = await executor.query(`INSERT INTO courses (name, description)
      VALUES ($1, $2)
      ON CONFLICT (name) DO UPDATE SET description = COALESCE(EXCLUDED.description, courses.description), updated_at = now()
      RETURNING id`, [String(row.name).trim(), row.description || null]);
    const programCourse = await executor.query(`INSERT INTO program_courses (program_id, course_id, code, year_no, semester_no, is_required, credits)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`, [
      Number(row.programId ?? row.program_id), course.rows[0].id, String(row.code).trim().toUpperCase(),
      Number(row.yearNo ?? row.year_no), Number(row.semesterNo ?? row.semester_no),
      row.isRequired ?? row.is_required ?? true, Number(row.credits ?? 0)
    ]);
    for (const code of String(row.prerequisites || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean)) {
      const prerequisite = await executor.query('SELECT id FROM program_courses WHERE lower(code) = $1 AND deleted_at IS NULL LIMIT 1', [code]);
      if (prerequisite.rowCount) await executor.query(`INSERT INTO course_prerequisites (course_id, prerequisite_course_id)
        VALUES ($1, $2) ON CONFLICT DO NOTHING`, [programCourse.rows[0].id, prerequisite.rows[0].id]);
    }
    return;
  }
  if (type === 'relationships') {
    const courseId = Number(row.courseId ?? row.course_id) || (await executor.query('SELECT id FROM program_courses WHERE lower(code) = $1 AND deleted_at IS NULL LIMIT 1', [String(row.courseCode ?? row.course_code ?? '').trim().toLowerCase()])).rows[0]?.id;
    const prerequisiteCourseId = Number(row.prerequisiteCourseId ?? row.prerequisite_course_id) || (await executor.query('SELECT id FROM program_courses WHERE lower(code) = $1 AND deleted_at IS NULL LIMIT 1', [String(row.prerequisiteCode ?? row.prerequisite_code ?? '').trim().toLowerCase()])).rows[0]?.id;
    await executor.query(`INSERT INTO course_prerequisites (course_id, prerequisite_course_id, visible_to_students)
      VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [courseId, prerequisiteCourseId, row.visibleToStudents ?? row.visible_to_students ?? true]);
  }
}
