export async function readCatalogSnapshot(executor) {
  const [faculties, programs, courses, relations, prerequisiteGroups] = await Promise.all([
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
        ORDER BY course_id, prerequisite_course_id`),
    executor.query(`SELECT g.course_id,g.group_type,g.label,g.position,cp.code AS prerequisite_code,m.minimum_grade,m.position AS member_position,COALESCE(rel.visible_to_students,false) AS visible_to_students
      FROM public.course_prerequisite_groups g JOIN public.program_courses target ON target.id=g.course_id AND target.deleted_at IS NULL
      LEFT JOIN public.course_prerequisite_group_members m ON m.group_id=g.id
      LEFT JOIN public.course_prerequisites rel ON rel.course_id=g.course_id AND rel.prerequisite_course_id=m.prerequisite_course_id AND rel.deleted_at IS NULL
      LEFT JOIN public.program_courses cp ON cp.id=m.prerequisite_course_id
      WHERE (m.id IS NULL OR rel.id IS NOT NULL)
        AND (g.legacy_relation_id IS NULL OR EXISTS(SELECT 1 FROM public.course_prerequisites legacy WHERE legacy.id=g.legacy_relation_id AND legacy.deleted_at IS NULL))
      ORDER BY g.course_id,g.position,g.id,m.position,m.id`)
  ]);
  return { faculties: faculties.rows, programs: programs.rows, programCourses: courses.rows, relationships: relations.rows, prerequisiteGroups: prerequisiteGroups.rows };
}

export async function readImportReferences(executor) {
  return Promise.all([
    executor.query('SELECT id, lower(name) AS name FROM faculties WHERE deleted_at IS NULL'),
    executor.query('SELECT id, faculty_id, lower(name) AS name FROM programs WHERE deleted_at IS NULL'),
    executor.query(`SELECT pc.id, pc.program_id, lower(pc.code) AS code, lower(c.name) AS name
         FROM program_courses pc
         JOIN courses c ON c.id = pc.course_id AND c.deleted_at IS NULL
        WHERE pc.deleted_at IS NULL`),
    executor.query(`SELECT id, course_id, prerequisite_course_id, visible_to_students
         FROM course_prerequisites
        WHERE deleted_at IS NULL`)
  ]);
}

export async function countDeletedCatalogEntities(executor) {
  return executor.query(
    `SELECT 'Faculty' AS entity, count(*)::int AS count FROM faculties WHERE deleted_at IS NOT NULL
     UNION ALL SELECT 'Program', count(*)::int FROM programs WHERE deleted_at IS NOT NULL
     UNION ALL SELECT 'Course', count(*)::int FROM program_courses WHERE deleted_at IS NOT NULL
     UNION ALL SELECT 'Relationship', count(*)::int FROM course_prerequisites WHERE deleted_at IS NOT NULL`
  );
}

export async function countActiveCatalogEntities(executor) {
  return executor.query(
    `SELECT
      (SELECT count(*)::int FROM faculties WHERE deleted_at IS NULL) AS faculties,
      (SELECT count(*)::int FROM programs WHERE deleted_at IS NULL) AS programs,
      (SELECT count(*)::int FROM courses WHERE deleted_at IS NULL) AS courses,
      (SELECT count(*)::int FROM program_courses WHERE deleted_at IS NULL) AS program_courses,
      (SELECT count(*)::int FROM course_prerequisites WHERE deleted_at IS NULL) AS relationships`
  );
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
      if (prerequisite.rowCount) {
        const relation=await executor.query(`INSERT INTO course_prerequisites (course_id, prerequisite_course_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id`, [programCourse.rows[0].id, prerequisite.rows[0].id]);
        if(relation.rowCount) {
          const group=await executor.query("INSERT INTO course_prerequisite_groups(course_id,group_type,label,legacy_relation_id) VALUES($1,'mandatory','Required prerequisite',$2) RETURNING id",[programCourse.rows[0].id,relation.rows[0].id]);
          await executor.query('INSERT INTO course_prerequisite_group_members(group_id,prerequisite_course_id,position) VALUES($1,$2,0)',[group.rows[0].id,prerequisite.rows[0].id]);
        }
      }
    }
    return;
  }
  if (type === 'relationships') {
    const courseId = Number(row.courseId ?? row.course_id) || (await executor.query('SELECT id FROM program_courses WHERE lower(code) = $1 AND deleted_at IS NULL LIMIT 1', [String(row.courseCode ?? row.course_code ?? '').trim().toLowerCase()])).rows[0]?.id;
    const prerequisiteCourseId = Number(row.prerequisiteCourseId ?? row.prerequisite_course_id) || (await executor.query('SELECT id FROM program_courses WHERE lower(code) = $1 AND deleted_at IS NULL LIMIT 1', [String(row.prerequisiteCode ?? row.prerequisite_code ?? '').trim().toLowerCase()])).rows[0]?.id;
    const relation=await executor.query(`INSERT INTO course_prerequisites (course_id, prerequisite_course_id, visible_to_students)
      VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING id`, [courseId, prerequisiteCourseId, row.visibleToStudents ?? row.visible_to_students ?? true]);
    if(relation.rowCount) {
      const group=await executor.query("INSERT INTO course_prerequisite_groups(course_id,group_type,label,legacy_relation_id) VALUES($1,'mandatory','Required prerequisite',$2) RETURNING id",[courseId,relation.rows[0].id]);
      await executor.query('INSERT INTO course_prerequisite_group_members(group_id,prerequisite_course_id,position) VALUES($1,$2,0)',[group.rows[0].id,prerequisiteCourseId]);
    }
    return;
  }
  if (type === 'prerequisiteGroups') {
    const target=(await executor.query('SELECT id FROM program_courses WHERE lower(code)=$1 AND deleted_at IS NULL',[String(row.courseCode||'').trim().toLowerCase()])).rows[0];
    if(!target) throw new Error('INVALID_PREREQUISITE_GROUP_TARGET');
    for(const [groupPosition,group] of row.groups.entries()) {
      const created=await executor.query('INSERT INTO course_prerequisite_groups(course_id,group_type,label,position) VALUES($1,$2,$3,$4) RETURNING id',[target.id,group.type,String(group.label).trim(),groupPosition]);
      for(const [memberPosition,member] of group.members.entries()) {
        const related=(await executor.query('SELECT id FROM program_courses WHERE lower(code)=$1 AND deleted_at IS NULL',[String(member.courseCode).trim().toLowerCase()])).rows[0];
        if(!related) throw new Error('INVALID_PREREQUISITE_GROUP_MEMBER');
        const relation=await executor.query('INSERT INTO course_prerequisites(course_id,prerequisite_course_id,visible_to_students) VALUES($1,$2,$3) ON CONFLICT(course_id,prerequisite_course_id) DO UPDATE SET visible_to_students=EXCLUDED.visible_to_students,deleted_at=NULL,updated_at=now() RETURNING id',[target.id,related.id,member.visibleToStudents!==false]);
        await executor.query('INSERT INTO course_prerequisite_group_members(group_id,prerequisite_course_id,position,minimum_grade) VALUES($1,$2,$3,$4)',[created.rows[0].id,related.id,memberPosition,member.minimumGrade||null]);
        if(group.type==='mandatory') await executor.query('UPDATE course_prerequisite_groups SET legacy_relation_id=$2 WHERE id=$1',[created.rows[0].id,relation.rows[0].id]);
      }
    }
  }
}
