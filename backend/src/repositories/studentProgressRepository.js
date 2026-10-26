export async function getStudentProgress(executor, userId) {
  const profile = await executor.query(`SELECT sap.program_id, p.name AS program_name, p.faculty_id, f.name AS faculty_name,
      sap.total_program_credits, sap.target_gpa
    FROM public.student_academic_profiles sap JOIN public.programs p ON p.id=sap.program_id
    JOIN public.faculties f ON f.id=p.faculty_id
    WHERE sap.user_id=$1 AND p.deleted_at IS NULL AND f.deleted_at IS NULL`, [userId]);
  const attempts = await executor.query(`SELECT a.id,a.program_id,a.program_course_id,a.grade,a.academic_year,a.term,pc.code,c.name AS course_name,pc.credits
    FROM public.student_course_attempts a JOIN public.program_courses pc ON pc.id=a.program_course_id
    JOIN public.courses c ON c.id=pc.course_id WHERE a.user_id=$1 ORDER BY a.academic_year,a.term,pc.code,a.created_at`, [userId]);
  return { profile: profile.rows[0] || null, attempts: attempts.rows };
}
export async function upsertStudentAcademicProfile(executor, userId, programId, profile = {}) {
  return executor.query(`INSERT INTO public.student_academic_profiles(user_id,program_id,verified,total_program_credits,target_gpa)
      VALUES ($1,$2,false,$5,$6)
    ON CONFLICT(user_id) DO UPDATE SET program_id=EXCLUDED.program_id,
      total_program_credits=CASE WHEN $3::boolean THEN EXCLUDED.total_program_credits
        WHEN student_academic_profiles.program_id=EXCLUDED.program_id THEN student_academic_profiles.total_program_credits ELSE NULL END,
      target_gpa=CASE WHEN $4::boolean THEN EXCLUDED.target_gpa
        WHEN student_academic_profiles.program_id=EXCLUDED.program_id THEN student_academic_profiles.target_gpa ELSE NULL END,
      updated_at=now()
    RETURNING user_id,program_id,total_program_credits,target_gpa`,
  [userId,programId,Object.hasOwn(profile,'totalProgramCredits'),Object.hasOwn(profile,'targetGpa'),profile.totalProgramCredits ?? null,profile.targetGpa ?? null]);
}
export async function listProgramCourseCredits(executor, programId) {
  return executor.query(`SELECT pc.id,pc.code,c.name,pc.credits FROM public.program_courses pc JOIN public.courses c ON c.id=pc.course_id
    WHERE pc.program_id=$1 AND pc.deleted_at IS NULL AND c.deleted_at IS NULL ORDER BY pc.year_no,pc.semester_no,pc.code`, [programId]);
}
export async function saveStudentAttempts(executor, userId, programId, attempts) {
  const retainedIds=[];
  for (const attempt of attempts) {
    if (attempt.id) {
      const result=await executor.query(`UPDATE public.student_course_attempts SET program_id=$3,program_course_id=$4,grade=$5,academic_year=$6,term=$7,updated_at=now()
        WHERE id=$1 AND user_id=$2 RETURNING id`, [attempt.id,userId,programId,attempt.programCourseId,attempt.grade,attempt.academicYear,attempt.term.trim()]);
      if (!result.rowCount) throw Object.assign(new Error('Attempt not found.'),{code:'STUDENT_ATTEMPT_NOT_FOUND'});
      retainedIds.push(attempt.id);
    } else {
      const result=await executor.query(`INSERT INTO public.student_course_attempts(user_id,program_id,program_course_id,grade,academic_year,term) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [userId,programId,attempt.programCourseId,attempt.grade,attempt.academicYear,attempt.term.trim()]);
      retainedIds.push(result.rows[0].id);
    }
  }
  await executor.query('DELETE FROM public.student_course_attempts WHERE user_id=$1 AND program_id=$2 AND NOT (id=ANY($3::uuid[]))',[userId,programId,retainedIds]);
}

export async function listProgramPrerequisiteGroups(executor, programId) {
  return (await executor.query(`SELECT g.course_id,g.id AS group_id,g.group_type,g.label,g.position,
      m.prerequisite_course_id,m.minimum_grade,m.position AS member_position,COALESCE(cp.visible_to_students,false) AS visible_to_students
    FROM public.course_prerequisite_groups g LEFT JOIN public.course_prerequisite_group_members m ON m.group_id=g.id
    JOIN public.program_courses target ON target.id=g.course_id AND target.deleted_at IS NULL
    LEFT JOIN public.program_courses prereq ON prereq.id=m.prerequisite_course_id AND prereq.deleted_at IS NULL
    LEFT JOIN public.course_prerequisites cp ON cp.course_id=g.course_id AND cp.prerequisite_course_id=m.prerequisite_course_id AND cp.deleted_at IS NULL
    WHERE target.program_id=$1 AND (m.id IS NULL OR prereq.program_id=$1)
      AND (m.id IS NULL OR cp.id IS NOT NULL)
      AND (g.legacy_relation_id IS NULL OR EXISTS(SELECT 1 FROM public.course_prerequisites legacy WHERE legacy.id=g.legacy_relation_id AND legacy.deleted_at IS NULL))
    ORDER BY g.course_id,g.position,g.id,m.position,m.id`,[programId])).rows;
}
