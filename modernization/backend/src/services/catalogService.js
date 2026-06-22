import { query, withPostgresClient } from '../db/client.js';

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

function mapProgramCourse(row, prerequisiteCourseIds = []) {
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
    prerequisiteCourseIds: prerequisiteCourseIds.map(toInt)
  };
}

async function prerequisiteMap(ids, client = null) {
  if (!ids.length) return new Map();
  const exec = client ? client.query.bind(client) : query;
  const { rows } = await exec(
    `SELECT course_id, prerequisite_course_id
       FROM course_prerequisites
      WHERE course_id = ANY($1::bigint[])`,
    [ids]
  );
  const map = new Map();
  for (const row of rows) {
    const courseId = toInt(row.course_id);
    if (!map.has(courseId)) map.set(courseId, []);
    map.get(courseId).push(toInt(row.prerequisite_course_id));
  }
  return map;
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
      LIMIT 1`,
    [id]
  );
  if (!rows.length) return null;
  const prereqs = await prerequisiteMap([id], client);
  return mapProgramCourse(rows[0], prereqs.get(toInt(id)) || []);
}

export async function getFaculties() {
  const { rows } = await query('SELECT id, name FROM faculties ORDER BY name');
  return rows.map(mapFaculty);
}

export async function createFaculty(data) {
  try {
    const { rows } = await query('INSERT INTO faculties (name) VALUES ($1) RETURNING id, name', [data.name.trim()]);
    return mapFaculty(rows[0]);
  } catch (error) {
    if (duplicate(error)) return null;
    throw error;
  }
}

export async function updateFaculty(id, data) {
  try {
    const { rows, rowCount } = await query(
      'UPDATE faculties SET name = COALESCE($2, name) WHERE id = $1 RETURNING id, name',
      [id, data.name?.trim()]
    );
    if (!rowCount) return false;
    return mapFaculty(rows[0]);
  } catch (error) {
    if (duplicate(error)) return null;
    throw error;
  }
}

export async function deleteFaculty(id) {
  const { rowCount } = await query('DELETE FROM faculties WHERE id = $1', [id]);
  return rowCount > 0;
}

export async function getPrograms(facultyId) {
  const { rows } = await query(
    `SELECT id, faculty_id, name, duration_years
       FROM programs
      WHERE ($1::bigint IS NULL OR faculty_id = $1)
      ORDER BY name`,
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
        RETURNING id, faculty_id, name, duration_years`,
      [id, data.facultyId, data.name?.trim(), data.durationYears]
    );
    if (!rowCount) return false;
    return mapProgram(rows[0]);
  } catch (error) {
    if (duplicate(error)) return null;
    throw error;
  }
}

export async function deleteProgram(id) {
  const { rowCount } = await query('DELETE FROM programs WHERE id = $1', [id]);
  return rowCount > 0;
}

export async function getProgramCourses(filters = {}) {
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
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
      ORDER BY pc.program_id, pc.year_no, pc.semester_no, pc.code`,
    params
  );
  const prereqs = await prerequisiteMap(rows.map((row) => row.id));
  return rows.map((row) => mapProgramCourse(row, prereqs.get(toInt(row.id)) || []));
}

export async function createProgramCourse(data) {
  try {
    return await withPostgresClient(async (client) => {
      await client.query('BEGIN');
      try {
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
        const current = await client.query('SELECT course_id FROM program_courses WHERE id = $1', [id]);
        if (!current.rowCount) {
          await client.query('ROLLBACK');
          return false;
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
  await client.query('DELETE FROM course_prerequisites WHERE course_id = $1', [courseId]);
  for (const prerequisiteCourseId of prerequisiteCourseIds) {
    if (Number(prerequisiteCourseId) === Number(courseId)) continue;
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

export async function deleteProgramCourse(id) {
  return withPostgresClient(async (client) => {
    await client.query('BEGIN');
    try {
      const current = await client.query('SELECT course_id FROM program_courses WHERE id = $1', [id]);
      if (!current.rowCount) {
        await client.query('ROLLBACK');
        return false;
      }
      const courseId = current.rows[0].course_id;
      await client.query('DELETE FROM course_prerequisites WHERE course_id = $1 OR prerequisite_course_id = $1', [id]);
      const { rowCount } = await client.query('DELETE FROM program_courses WHERE id = $1', [id]);
      const stillUsed = await client.query('SELECT 1 FROM program_courses WHERE course_id = $1 LIMIT 1', [courseId]);
      if (!stillUsed.rowCount) await client.query('DELETE FROM courses WHERE id = $1', [courseId]);
      await client.query('COMMIT');
      return rowCount > 0;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    }
  });
}

export async function getPrerequisites(programCourseId) {
  const map = await prerequisiteMap([programCourseId]);
  return map.get(programCourseId) || [];
}

export async function updatePrerequisites(programCourseId, prerequisiteCourseIds) {
  await withPostgresClient(async (client) => {
    await client.query('BEGIN');
    try {
      const exists = await client.query('SELECT 1 FROM program_courses WHERE id = $1', [programCourseId]);
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

export async function getCatalog() {
  const [faculties, programs, programCourses] = await Promise.all([
    getFaculties(),
    getPrograms(),
    getProgramCourses()
  ]);
  return { faculties, programs, programCourses };
}
