import { query, withPostgresClient } from '../db/client.js';
import { logAdminAction } from './adminOpsService.js';

function duplicate(error) {
  return String(error?.code) === '23505';
}

function cleanText(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function toInt(value) {
  return Number(value);
}

function mapFaculty(row) {
  return { id: toInt(row.id), name: row.name };
}

function mapProgram(row) {
  return {
    id: toInt(row.id),
    facultyId: toInt(row.faculty_id),
    name: row.name,
    durationYears: toInt(row.duration_years)
  };
}

function mapPrerequisiteRelation(row) {
  return {
    id: toInt(row.id),
    courseId: toInt(row.course_id),
    prerequisiteCourseId: toInt(row.prerequisite_course_id),
    visibleToStudents: row.visible_to_students !== false
  };
}

function mapProgramCourse(row, prerequisiteRelations = []) {
  return {
    id: toInt(row.id),
    programId: toInt(row.program_id),
    facultyId: toInt(row.faculty_id),
    courseId: toInt(row.course_id),
    name: row.name,
    code: row.code,
    yearNo: toInt(row.year_no),
    semesterNo: toInt(row.semester_no),
    credits: toInt(row.credits),
    isRequired: row.is_required,
    description: row.description ?? null,
    prerequisiteCourseIds: prerequisiteRelations.map((relation) => relation.prerequisiteCourseId),
    prerequisiteRelations
  };
}

async function prerequisiteMap(ids, client = null, { includeHidden = false } = {}) {
  if (!ids.length) return new Map();
  const exec = client ? client.query.bind(client) : query;
  const { rows } = await exec(
    `SELECT id, course_id, prerequisite_course_id, visible_to_students
       FROM course_prerequisites
      WHERE course_id = ANY($1::bigint[])
        AND ($2::boolean = true OR visible_to_students = true)
        AND deleted_at IS NULL
      ORDER BY course_id, prerequisite_course_id`,
    [ids, includeHidden]
  );
  const map = new Map();
  for (const row of rows) {
    const courseId = toInt(row.course_id);
    if (!map.has(courseId)) map.set(courseId, []);
    map.get(courseId).push(mapPrerequisiteRelation(row));
  }
  return map;
}

async function getRelationshipImpactForProgramCourses(client, ids) {
  if (!ids.length) return { prerequisiteLinks: [], requiredForLinks: [] };
  const { rows } = await client.query(
    `SELECT cp.id, cp.course_id, cp.prerequisite_course_id, cp.visible_to_students,
            cpc.code AS course_code, cc.name AS course_name,
            cpp.code AS prerequisite_code, pc.name AS prerequisite_name
       FROM course_prerequisites cp
       JOIN program_courses cpc ON cpc.id = cp.course_id
       JOIN courses cc ON cc.id = cpc.course_id
       JOIN program_courses cpp ON cpp.id = cp.prerequisite_course_id
       JOIN courses pc ON pc.id = cpp.course_id
      WHERE (cp.course_id = ANY($1::bigint[])
         OR cp.prerequisite_course_id = ANY($1::bigint[]))
        AND cp.deleted_at IS NULL
      ORDER BY cpc.code, cpp.code`,
    [ids]
  );
  const prerequisiteLinks = [];
  const requiredForLinks = [];
  for (const row of rows) {
    const relation = {
      id: toInt(row.id),
      courseId: toInt(row.course_id),
      prerequisiteCourseId: toInt(row.prerequisite_course_id),
      courseCode: row.course_code,
      courseName: row.course_name,
      prerequisiteCode: row.prerequisite_code,
      prerequisiteName: row.prerequisite_name,
      visibleToStudents: row.visible_to_students !== false
    };
    if (ids.map(Number).includes(toInt(row.course_id))) prerequisiteLinks.push(relation);
    if (ids.map(Number).includes(toInt(row.prerequisite_course_id))) requiredForLinks.push(relation);
  }
  return { prerequisiteLinks, requiredForLinks };
}

async function getProgramCourseById(id, client = null) {
  const exec = client ? client.query.bind(client) : query;
  const { rows } = await exec(
    `SELECT pc.id, pc.program_id, p.faculty_id, pc.course_id, c.name, pc.code,
            pc.year_no, pc.semester_no, pc.credits, pc.is_required, c.description
       FROM program_courses pc
       JOIN courses c ON c.id = pc.course_id
       JOIN programs p ON p.id = pc.program_id
      WHERE pc.id = $1
        AND pc.deleted_at IS NULL
        AND p.deleted_at IS NULL
        AND c.deleted_at IS NULL
      LIMIT 1`,
    [id]
  );
  if (!rows.length) return null;
  const prereqs = await prerequisiteMap([id], client, { includeHidden: true });
  return mapProgramCourse(rows[0], prereqs.get(toInt(id)) || []);
}

export async function getFaculties() {
  const { rows } = await query('SELECT id, name FROM faculties WHERE deleted_at IS NULL ORDER BY name');
  return rows.map(mapFaculty);
}

export async function createFaculty(data) {
  try {
    const { rows } = await query('INSERT INTO faculties (name) VALUES ($1) RETURNING id, name', [data.name.trim()]);
    await logAdminAction(null, { action: 'Created Faculty', entity: 'faculty', entityId: rows[0].id, newValues: rows[0], description: `Created faculty ${rows[0].name}` });
    return mapFaculty(rows[0]);
  } catch (error) {
    if (duplicate(error)) return null;
    throw error;
  }
}

export async function updateFaculty(id, data) {
  try {
    return await withPostgresClient(async (client) => {
      await client.query('BEGIN');
      try {
        const current = await client.query('SELECT id, name FROM faculties WHERE id = $1 AND deleted_at IS NULL', [id]);
        if (!current.rowCount) {
          await client.query('ROLLBACK');
          return false;
        }
        const { rows, rowCount } = await client.query(
          'UPDATE faculties SET name = COALESCE($2, name), updated_at = now() WHERE id = $1 RETURNING id, name',
          [id, data.name?.trim()]
        );
        if (!rowCount) {
          await client.query('ROLLBACK');
          return false;
        }
        await logAdminAction(client, { action: 'Updated Faculty', entity: 'faculty', entityId: id, oldValues: current.rows[0], newValues: rows[0], description: `Updated faculty ${rows[0].name}` });
        await client.query('COMMIT');
        return mapFaculty(rows[0]);
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      }
    });
  } catch (error) {
    if (duplicate(error)) return null;
    throw error;
  }
}

export async function deleteFaculty(id) {
  return withPostgresClient(async (client) => {
    await client.query('BEGIN');
    try {
      const current = await client.query('SELECT id, name FROM faculties WHERE id = $1 AND deleted_at IS NULL', [id]);
      if (!current.rowCount) {
        await client.query('ROLLBACK');
        return false;
      }
      const childCourses = await client.query(
        `SELECT pc.id
           FROM program_courses pc
           JOIN programs p ON p.id = pc.program_id
          WHERE p.faculty_id = $1
            AND pc.deleted_at IS NULL`,
        [id]
      );
      const childCourseIds = childCourses.rows.map((row) => toInt(row.id));
      if (childCourseIds.length) {
        await client.query(
          "UPDATE course_prerequisites SET deleted_at = now(), deleted_by = 'Admin', delete_reason = 'Parent faculty deleted', updated_at = now() WHERE course_id = ANY($1::bigint[]) OR prerequisite_course_id = ANY($1::bigint[])",
          [childCourseIds]
        );
        await client.query(
          "UPDATE program_courses SET deleted_at = now(), deleted_by = 'Admin', delete_reason = 'Parent faculty deleted', updated_at = now() WHERE id = ANY($1::bigint[])",
          [childCourseIds]
        );
      }
      await client.query(
        "UPDATE programs SET deleted_at = now(), deleted_by = 'Admin', delete_reason = 'Parent faculty deleted', updated_at = now() WHERE faculty_id = $1 AND deleted_at IS NULL",
        [id]
      );
      const { rowCount } = await client.query(
        "UPDATE faculties SET deleted_at = now(), deleted_by = 'Admin', delete_reason = 'Admin delete', updated_at = now() WHERE id = $1",
        [id]
      );
      await logAdminAction(client, { action: 'Deleted Faculty', entity: 'faculty', entityId: id, oldValues: current.rows[0], description: `Moved faculty ${current.rows[0].name} to recycle bin` });
      await client.query('COMMIT');
      return rowCount > 0;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    }
  });
}

export async function getPrograms(facultyId) {
  const { rows } = await query(
    `SELECT p.id, p.faculty_id, p.name, p.duration_years
       FROM programs p
       JOIN faculties f ON f.id = p.faculty_id AND f.deleted_at IS NULL
      WHERE ($1::bigint IS NULL OR p.faculty_id = $1)
        AND p.deleted_at IS NULL
      ORDER BY p.name`,
    [facultyId || null]
  );
  return rows.map(mapProgram);
}

export async function createProgram(data) {
  try {
    const { rows } = await query(
      `INSERT INTO programs (faculty_id, name, duration_years)
       VALUES ($1, $2, $3)
       RETURNING id, faculty_id, name, duration_years`,
      [data.facultyId, data.name.trim(), data.durationYears]
    );
    await logAdminAction(null, { action: 'Created Program', entity: 'program', entityId: rows[0].id, newValues: rows[0], description: `Created program ${rows[0].name}` });
    return mapProgram(rows[0]);
  } catch (error) {
    if (duplicate(error)) return null;
    throw error;
  }
}

export async function updateProgram(id, data) {
  try {
    const { rows, rowCount } = await query(
      `UPDATE programs
          SET faculty_id = COALESCE($2, faculty_id),
              name = COALESCE($3, name),
              duration_years = COALESCE($4, duration_years)
        WHERE id = $1
          AND deleted_at IS NULL
        RETURNING id, faculty_id, name, duration_years`,
      [id, data.facultyId, data.name?.trim(), data.durationYears]
    );
    if (!rowCount) return false;
    await logAdminAction(null, { action: 'Updated Program', entity: 'program', entityId: id, newValues: rows[0], description: `Updated program ${rows[0].name}` });
    return mapProgram(rows[0]);
  } catch (error) {
    if (duplicate(error)) return null;
    throw error;
  }
}

export async function getProgramDeleteImpact(id) {
  return withPostgresClient(async (client) => {
    const program = await client.query('SELECT id, name FROM programs WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (!program.rowCount) return null;
    const courses = await client.query(
      `SELECT pc.id, pc.course_id, pc.code, c.name
         FROM program_courses pc
         JOIN courses c ON c.id = pc.course_id
        WHERE pc.program_id = $1
          AND pc.deleted_at IS NULL
        ORDER BY pc.code`,
      [id]
    );
    const ids = courses.rows.map((row) => toInt(row.id));
    const relations = await getRelationshipImpactForProgramCourses(client, ids);
    return {
      program: { id: toInt(program.rows[0].id), name: program.rows[0].name },
      courseCount: courses.rowCount,
      courses: courses.rows.map((row) => ({ id: toInt(row.id), courseId: toInt(row.course_id), code: row.code, name: row.name })),
      prerequisiteLinkCount: relations.prerequisiteLinks.length,
      requiredForLinkCount: relations.requiredForLinks.length
    };
  });
}

export async function deleteProgram(id) {
  return withPostgresClient(async (client) => {
    await client.query('BEGIN');
    try {
      const current = await client.query('SELECT id, name FROM programs WHERE id = $1 AND deleted_at IS NULL', [id]);
      if (!current.rowCount) {
        await client.query('ROLLBACK');
        return false;
      }
      const programCourses = await client.query('SELECT id, course_id FROM program_courses WHERE program_id = $1 AND deleted_at IS NULL', [id]);
      const programCourseIds = programCourses.rows.map((row) => toInt(row.id));
      if (programCourseIds.length) {
        await client.query(
          "UPDATE course_prerequisites SET deleted_at = now(), deleted_by = 'Admin', delete_reason = 'Parent program deleted', updated_at = now() WHERE course_id = ANY($1::bigint[]) OR prerequisite_course_id = ANY($1::bigint[])",
          [programCourseIds]
        );
        await client.query("UPDATE program_courses SET deleted_at = now(), deleted_by = 'Admin', delete_reason = 'Parent program deleted', updated_at = now() WHERE id = ANY($1::bigint[])", [programCourseIds]);
      }
      const { rowCount } = await client.query("UPDATE programs SET deleted_at = now(), deleted_by = 'Admin', delete_reason = 'Admin delete', updated_at = now() WHERE id = $1", [id]);
      await logAdminAction(client, { action: 'Deleted Program', entity: 'program', entityId: id, oldValues: current.rows[0], description: `Moved program ${current.rows[0].name} to recycle bin` });
      await client.query('COMMIT');
      return rowCount > 0;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    }
  });
}

export async function getProgramCourses(filters = {}, options = {}) {
  const params = [];
  const conditions = [];

  if (filters.facultyId != null) {
    params.push(filters.facultyId);
    conditions.push(`p.faculty_id = $${params.length}`);
  }
  if (filters.programId != null) {
    params.push(filters.programId);
    conditions.push(`pc.program_id = $${params.length}`);
  }
  if (filters.yearNo != null) {
    params.push(filters.yearNo);
    conditions.push(`pc.year_no = $${params.length}`);
  }
  if (filters.semesterNo != null) {
    params.push(filters.semesterNo);
    conditions.push(`pc.semester_no = $${params.length}`);
  }

  const { rows } = await query(
    `SELECT pc.id, pc.program_id, p.faculty_id, pc.course_id, c.name, pc.code,
            pc.year_no, pc.semester_no, pc.credits, pc.is_required, c.description
      FROM program_courses pc
      JOIN courses c ON c.id = pc.course_id
      JOIN programs p ON p.id = pc.program_id
      WHERE pc.deleted_at IS NULL
        AND c.deleted_at IS NULL
        AND p.deleted_at IS NULL
        ${conditions.length ? `AND ${conditions.join(' AND ')}` : ''}
      ORDER BY pc.program_id, pc.year_no, pc.semester_no, pc.code`,
    params
  );
  const prereqs = await prerequisiteMap(rows.map((row) => row.id), null, options);
  return rows.map((row) => mapProgramCourse(row, prereqs.get(toInt(row.id)) || []));
}

export async function createProgramCourse(data) {
  try {
    return await withPostgresClient(async (client) => {
      await client.query('BEGIN');
      try {
        const duplicateCourse = await client.query(
          `SELECT 1
             FROM program_courses pc
             JOIN courses c ON c.id = pc.course_id
            WHERE pc.deleted_at IS NULL
              AND (lower(pc.code) = lower($1)
               OR lower(c.name) = lower($2))
            LIMIT 1`,
          [data.code.trim(), data.name.trim()]
        );
        if (duplicateCourse.rowCount) {
          await client.query('ROLLBACK');
          return null;
        }

        const course = await client.query(
          `INSERT INTO courses (name, description)
           VALUES ($1, $2)
           ON CONFLICT (name)
           DO UPDATE SET description = COALESCE(EXCLUDED.description, courses.description)
           RETURNING id`,
          [data.name.trim(), cleanText(data.description)]
        );
        const courseId = course.rows[0].id;
        const programCourse = await client.query(
          `INSERT INTO program_courses (program_id, course_id, code, year_no, semester_no, is_required, credits)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id`,
          [data.programId, courseId, data.code.trim(), data.yearNo, data.semesterNo, data.isRequired ?? true, data.credits]
        );
        await replacePrerequisites(client, programCourse.rows[0].id, data.prerequisiteCourseIds || []);
        await logAdminAction(client, { action: 'Created Course', entity: 'course', entityId: programCourse.rows[0].id, newValues: { ...data, id: programCourse.rows[0].id }, description: `Created course ${data.code.trim().toUpperCase()}` });
        await client.query('COMMIT');
        return getProgramCourseById(programCourse.rows[0].id);
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      }
    });
  } catch (error) {
    if (duplicate(error)) return null;
    throw error;
  }
}

export async function updateProgramCourse(id, data) {
  try {
    return await withPostgresClient(async (client) => {
      await client.query('BEGIN');
      try {
        const current = await client.query(
          `SELECT pc.*, c.name, c.description
             FROM program_courses pc
             JOIN courses c ON c.id = pc.course_id
            WHERE pc.id = $1 AND pc.deleted_at IS NULL`,
          [id]
        );
        if (!current.rowCount) {
          await client.query('ROLLBACK');
          return false;
        }

        if (data.code !== undefined || data.name !== undefined) {
          const duplicateCourse = await client.query(
            `SELECT 1
               FROM program_courses pc
               JOIN courses c ON c.id = pc.course_id
              WHERE pc.id <> $1
                AND pc.deleted_at IS NULL
                AND (
                  ($2::text IS NOT NULL AND lower(pc.code) = lower($2))
                  OR ($3::text IS NOT NULL AND lower(c.name) = lower($3))
                )
              LIMIT 1`,
            [id, data.code?.trim() ?? null, data.name?.trim() ?? null]
          );
          if (duplicateCourse.rowCount) {
            await client.query('ROLLBACK');
            return null;
          }
        }

        if (data.name !== undefined || data.description !== undefined) {
          await client.query(
            `UPDATE courses
                SET name = COALESCE($2, name),
                    description = COALESCE($3, description)
              WHERE id = $1`,
            [current.rows[0].course_id, data.name?.trim(), cleanText(data.description)]
          );
        }

        await client.query(
          `UPDATE program_courses
              SET program_id = COALESCE($2, program_id),
                  code = COALESCE($3, code),
                  year_no = COALESCE($4, year_no),
                  semester_no = COALESCE($5, semester_no),
                  is_required = COALESCE($6, is_required),
                  credits = COALESCE($7, credits)
            WHERE id = $1`,
          [id, data.programId, data.code?.trim(), data.yearNo, data.semesterNo, data.isRequired, data.credits]
        );

        if (Array.isArray(data.prerequisiteCourseIds)) {
          await replacePrerequisites(client, id, data.prerequisiteCourseIds);
        }

        await logAdminAction(client, { action: 'Updated Course', entity: 'course', entityId: id, oldValues: current.rows[0], newValues: data, description: `Updated course ${data.code || current.rows[0].code}` });
        await client.query('COMMIT');
        return getProgramCourseById(id);
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      }
    });
  } catch (error) {
    if (duplicate(error)) return null;
    throw error;
  }
}

async function replacePrerequisites(client, courseId, prerequisiteCourseIds) {
  const ids = [...new Set(prerequisiteCourseIds.map(Number).filter((id) => id !== Number(courseId)))];
  if (ids.length) {
    await client.query('DELETE FROM course_prerequisites WHERE course_id = $1 AND NOT (prerequisite_course_id = ANY($2::bigint[]))', [courseId, ids]);
  } else {
    await client.query('DELETE FROM course_prerequisites WHERE course_id = $1', [courseId]);
  }
  for (const prerequisiteCourseId of ids) {
    const exists = await client.query('SELECT 1 FROM program_courses WHERE id = $1', [prerequisiteCourseId]);
    if (!exists.rowCount) throw new Error('FK_PROGRAM_COURSE');
    await client.query(
      `INSERT INTO course_prerequisites (course_id, prerequisite_course_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [courseId, prerequisiteCourseId]
    );
  }
}

export async function getProgramCourseDeleteImpact(id) {
  return withPostgresClient(async (client) => {
    const current = await client.query(
      `SELECT pc.id, pc.course_id, pc.code, c.name
         FROM program_courses pc
         JOIN courses c ON c.id = pc.course_id
        WHERE pc.id = $1
          AND pc.deleted_at IS NULL`,
      [id]
    );
    if (!current.rowCount) return null;
    const relations = await getRelationshipImpactForProgramCourses(client, [id]);
    return {
      course: {
        id: toInt(current.rows[0].id),
        courseId: toInt(current.rows[0].course_id),
        code: current.rows[0].code,
        name: current.rows[0].name
      },
      prerequisiteLinks: relations.prerequisiteLinks,
      requiredForLinks: relations.requiredForLinks
    };
  });
}

export async function deleteProgramCourse(id) {
  return withPostgresClient(async (client) => {
    await client.query('BEGIN');
    try {
      const current = await client.query(
        `SELECT pc.id, pc.course_id, pc.code, c.name
           FROM program_courses pc
           JOIN courses c ON c.id = pc.course_id
          WHERE pc.id = $1 AND pc.deleted_at IS NULL`,
        [id]
      );
      if (!current.rowCount) {
        await client.query('ROLLBACK');
        return false;
      }
      await client.query("UPDATE course_prerequisites SET deleted_at = now(), deleted_by = 'Admin', delete_reason = 'Related course deleted', updated_at = now() WHERE course_id = $1 OR prerequisite_course_id = $1", [id]);
      const { rowCount } = await client.query("UPDATE program_courses SET deleted_at = now(), deleted_by = 'Admin', delete_reason = 'Admin delete', updated_at = now() WHERE id = $1", [id]);
      await logAdminAction(client, { action: 'Deleted Course', entity: 'course', entityId: id, oldValues: current.rows[0], description: `Moved course ${current.rows[0].code} to recycle bin` });
      await client.query('COMMIT');
      return rowCount > 0;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    }
  });
}

export async function getPrerequisites(programCourseId) {
  const map = await prerequisiteMap([programCourseId], null, { includeHidden: true });
  return (map.get(programCourseId) || []).map((relation) => relation.prerequisiteCourseId);
}

export async function updatePrerequisites(programCourseId, prerequisiteCourseIds) {
  await withPostgresClient(async (client) => {
    await client.query('BEGIN');
    try {
      const exists = await client.query('SELECT 1 FROM program_courses WHERE id = $1 AND deleted_at IS NULL', [programCourseId]);
      if (!exists.rowCount) {
        await client.query('ROLLBACK');
        return false;
      }
      await replacePrerequisites(client, programCourseId, prerequisiteCourseIds);
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    }
  });
  return getPrerequisites(programCourseId);
}

export async function addPrerequisiteRelation(programCourseId, prerequisiteCourseId) {
  if (Number(programCourseId) === Number(prerequisiteCourseId)) throw new Error('FK_SELF_RELATION');
  try {
    const { rows } = await query(
      `INSERT INTO course_prerequisites (course_id, prerequisite_course_id)
       VALUES ($1, $2)
       RETURNING id, course_id, prerequisite_course_id, visible_to_students`,
      [programCourseId, prerequisiteCourseId]
    );
    await logAdminAction(null, { action: 'Created Relation', entity: 'relation', entityId: rows[0].id, newValues: rows[0], description: 'Created prerequisite relationship' });
    return mapPrerequisiteRelation(rows[0]);
  } catch (error) {
    if (duplicate(error)) return null;
    if (String(error?.code) === '23503' || String(error?.code) === '23514') throw new Error('FK_PROGRAM_COURSE');
    throw error;
  }
}

export async function deletePrerequisiteRelation(programCourseId, prerequisiteCourseId) {
  const { rows, rowCount } = await query(
    `UPDATE course_prerequisites
        SET deleted_at = now(),
            deleted_by = 'Admin',
            delete_reason = 'Admin delete',
            updated_at = now()
      WHERE course_id = $1
        AND prerequisite_course_id = $2
        AND deleted_at IS NULL
      RETURNING id, course_id, prerequisite_course_id, visible_to_students`,
    [programCourseId, prerequisiteCourseId]
  );
  if (rowCount) await logAdminAction(null, { action: 'Deleted Relation', entity: 'relation', entityId: rows[0].id, oldValues: rows[0], description: 'Moved prerequisite relationship to recycle bin' });
  return rowCount > 0;
}

export async function updatePrerequisiteVisibility(programCourseId, prerequisiteCourseId, visibleToStudents) {
  const { rows, rowCount } = await query(
    `UPDATE course_prerequisites
        SET visible_to_students = $3,
            updated_at = now()
      WHERE course_id = $1
        AND prerequisite_course_id = $2
        AND deleted_at IS NULL
      RETURNING id, course_id, prerequisite_course_id, visible_to_students`,
    [programCourseId, prerequisiteCourseId, visibleToStudents]
  );
  if (rowCount) await logAdminAction(null, { action: visibleToStudents ? 'Restored Relation Visibility' : 'Hidden Relation', entity: 'relation', entityId: rows[0].id, newValues: rows[0], description: `Relation ${visibleToStudents ? 'shown to' : 'hidden from'} students` });
  return rowCount > 0;
}

export async function getCatalog(options = {}) {
  const [faculties, programs, programCourses] = await Promise.all([
    getFaculties(),
    getPrograms(),
    getProgramCourses({}, options)
  ]);
  return { faculties, programs, programCourses };
}
