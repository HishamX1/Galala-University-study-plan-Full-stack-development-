import { query, withPostgresClient } from '../db/client.js';
import { logAdminAction } from './adminOpsService.js';
import { findActiveFaculty, insertFaculty, listActiveFaculties, listActiveFacultyProgramCourseIds, softDeleteFaculty, updateActiveFaculty } from '../repositories/facultyRepository.js';
import { findActiveProgram, insertProgram, listActivePrograms, softDeleteProgram, softDeleteProgramsForFaculty, updateActiveProgram } from '../repositories/programRepository.js';
import { findActiveProgramCourseDetail, findActiveProgramCourseSummary, findDuplicateProgramCourse, findProgramCourseWithCourse, insertProgramCourse, listActiveProgramCourseSummaries, listActiveProgramCourses, programCourseExists, programCourseRecordExists, softDeleteProgramCourse, softDeleteProgramCourses, touchProgramCourse, updateProgramCourseRow } from '../repositories/programCourseRepository.js';
import { updateCourse, upsertCourse } from '../repositories/courseRepository.js';
import { createPrerequisiteRow, listActivePrerequisiteRows, listRelationshipImpactRows, replacePrerequisiteRows, softDeletePrerequisiteRow, softDeletePrerequisitesForCourses, updatePrerequisiteVisibilityRow } from '../repositories/prerequisiteRepository.js';
import { AppError } from '../utils/errors.js';

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

function timestamp(value) {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  return value.toISOString();
}

function staleWrite() {
  return new AppError('This record changed since you loaded it. Refresh the catalog, compare the latest values, then retry.', 409, 'STALE_WRITE');
}

function mapFaculty(row) {
  return { id: toInt(row.id), name: row.name, version: { updatedAt: timestamp(row.updated_at) } };
}

function mapProgram(row) {
  return {
    id: toInt(row.id),
    facultyId: toInt(row.faculty_id),
    name: row.name,
    durationYears: toInt(row.duration_years),
    version: { updatedAt: timestamp(row.updated_at) }
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
    version: { updatedAt: timestamp(row.updated_at), relatedUpdatedAt: timestamp(row.course_updated_at) },
    prerequisiteCourseIds: prerequisiteRelations.map((relation) => relation.prerequisiteCourseId),
    prerequisiteRelations
  };
}

async function prerequisiteMap(ids, client = null, { includeHidden = false } = {}) {
  if (!ids.length) return new Map();
  const rows = await listActivePrerequisiteRows(ids, includeHidden, client || { query });
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
  const rows = await listRelationshipImpactRows(ids, client);
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
  const rows = await findActiveProgramCourseDetail(id, client || { query });
  if (!rows.length) return null;
  const prereqs = await prerequisiteMap([id], client, { includeHidden: true });
  return mapProgramCourse(rows[0], prereqs.get(toInt(id)) || []);
}

export async function getFaculties() {
  const rows = await listActiveFaculties({ query });
  return rows.map(mapFaculty);
}

export async function createFaculty(data) {
  try {
    return await withPostgresClient(async (client) => {
      await client.query('BEGIN');
      try {
        const created = await insertFaculty(data.name.trim(), client);
        await logAdminAction(client, { action: 'Created Faculty', entity: 'faculty', entityId: created.id, newValues: created, description: `Created faculty ${created.name}` });
        await client.query('COMMIT');
        return mapFaculty(created);
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

export async function updateFaculty(id, data) {
  try {
    return await withPostgresClient(async (client) => {
      await client.query('BEGIN');
      try {
        const current = await findActiveFaculty(id, client);
        if (!current.rowCount) {
          await client.query('ROLLBACK');
          return false;
        }
        const { rows, rowCount } = await updateActiveFaculty(id, data.name?.trim(), client, data.expectedVersion?.updatedAt);
        if (!rowCount) {
          await client.query('ROLLBACK');
          if (data.expectedVersion && (await findActiveFaculty(id, client)).rowCount) throw staleWrite();
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

export async function deleteFaculty(id, expectedVersion) {
  return withPostgresClient(async (client) => {
    await client.query('BEGIN');
    try {
      const current = await findActiveFaculty(id, client);
      if (!current.rowCount) {
        await client.query('ROLLBACK');
        return false;
      }
      const childCourseIds = (await listActiveFacultyProgramCourseIds(id, client)).map((row) => toInt(row.id));
      if (childCourseIds.length) {
        await softDeletePrerequisitesForCourses(childCourseIds, 'Parent faculty deleted', client);
        await softDeleteProgramCourses(childCourseIds, 'Parent faculty deleted', client);
      }
      await softDeleteProgramsForFaculty(id, client);
      const { rowCount } = await softDeleteFaculty(id, client, expectedVersion?.updatedAt);
      if (!rowCount) {
        await client.query('ROLLBACK');
        if (expectedVersion && (await findActiveFaculty(id, client)).rowCount) throw staleWrite();
        return false;
      }
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
  const rows = await listActivePrograms(facultyId, { query });
  return rows.map(mapProgram);
}

export async function createProgram(data) {
  try {
    return await withPostgresClient(async (client) => {
      await client.query('BEGIN');
      try {
        const created = await insertProgram(data, client);
        await logAdminAction(client, { action: 'Created Program', entity: 'program', entityId: created.id, newValues: created, description: `Created program ${created.name}` });
        await client.query('COMMIT');
        return mapProgram(created);
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

export async function updateProgram(id, data) {
  try {
    return await withPostgresClient(async (client) => {
      await client.query('BEGIN');
      try {
        const { rows, rowCount } = await updateActiveProgram(id, data, client, data.expectedVersion?.updatedAt);
        if (!rowCount) {
          await client.query('ROLLBACK');
          if (data.expectedVersion && (await findActiveProgram(id, client)).rowCount) throw staleWrite();
          return false;
        }
        await logAdminAction(client, { action: 'Updated Program', entity: 'program', entityId: id, newValues: rows[0], description: `Updated program ${rows[0].name}` });
        await client.query('COMMIT');
        return mapProgram(rows[0]);
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

export async function getProgramDeleteImpact(id) {
  return withPostgresClient(async (client) => {
    const program = await findActiveProgram(id, client);
    if (!program.rowCount) return null;
    const courses = await listActiveProgramCourseSummaries(id, client);
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

export async function deleteProgram(id, expectedVersion) {
  return withPostgresClient(async (client) => {
    await client.query('BEGIN');
    try {
      const current = await findActiveProgram(id, client);
      if (!current.rowCount) {
        await client.query('ROLLBACK');
        return false;
      }
      const programCourses = await listActiveProgramCourseSummaries(id, client);
      const programCourseIds = programCourses.rows.map((row) => toInt(row.id));
      if (programCourseIds.length) {
        await softDeletePrerequisitesForCourses(programCourseIds, 'Parent program deleted', client);
        await softDeleteProgramCourses(programCourseIds, 'Parent program deleted', client);
      }
      const { rowCount } = await softDeleteProgram(id, client, expectedVersion?.updatedAt);
      if (!rowCount) {
        await client.query('ROLLBACK');
        if (expectedVersion && (await findActiveProgram(id, client)).rowCount) throw staleWrite();
        return false;
      }
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
  const rows = await listActiveProgramCourses(filters, { query });
  const prereqs = await prerequisiteMap(rows.map((row) => row.id), null, options);
  return rows.map((row) => mapProgramCourse(row, prereqs.get(toInt(row.id)) || []));
}

export async function createProgramCourse(data) {
  try {
    return await withPostgresClient(async (client) => {
      await client.query('BEGIN');
      try {
        const duplicateCourse = await findDuplicateProgramCourse(data.code.trim(), data.name.trim(), null, client);
        if (duplicateCourse.rowCount) {
          await client.query('ROLLBACK');
          return null;
        }

        const courseId = (await upsertCourse(data.name.trim(), cleanText(data.description), client)).id;
        const programCourse = await insertProgramCourse(data, courseId, client);
        await replacePrerequisites(client, programCourse.id, data.prerequisiteCourseIds || []);
        await logAdminAction(client, { action: 'Created Course', entity: 'course', entityId: programCourse.id, newValues: { ...data, id: programCourse.id }, description: `Created course ${data.code.trim().toUpperCase()}` });
        await client.query('COMMIT');
        return getProgramCourseById(programCourse.id);
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
        const current = await findProgramCourseWithCourse(id, client);
        if (!current.rowCount) {
          await client.query('ROLLBACK');
          return false;
        }

        if (data.code !== undefined || data.name !== undefined) {
          const duplicateCourse = await findDuplicateProgramCourse(data.code?.trim() ?? null, data.name?.trim() ?? null, id, client);
          if (duplicateCourse.rowCount) {
            await client.query('ROLLBACK');
            return null;
          }
        }

        const rowUpdate = await updateProgramCourseRow(id, data, client, data.expectedVersion?.updatedAt);
        if (!rowUpdate.rowCount) {
          await client.query('ROLLBACK');
          if (data.expectedVersion && (await findProgramCourseWithCourse(id, client)).rowCount) throw staleWrite();
          return false;
        }

        if (data.name !== undefined || data.description !== undefined) {
          const courseUpdate = await updateCourse(current.rows[0].course_id, data.name?.trim(), cleanText(data.description), client, data.expectedVersion?.relatedUpdatedAt);
          if (!courseUpdate.rowCount) throw staleWrite();
        }

        if (Array.isArray(data.prerequisiteCourseIds)) {
          await replacePrerequisites(client, id, data.prerequisiteCourseIds);
        }

        const { expectedVersion: _expectedVersion, ...auditValues } = data;
        await logAdminAction(client, { action: 'Updated Course', entity: 'course', entityId: id, oldValues: current.rows[0], newValues: auditValues, description: `Updated course ${data.code || current.rows[0].code}` });
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
  await replacePrerequisiteRows(courseId, ids, client);
  for (const prerequisiteCourseId of ids) {
    if (!(await programCourseRecordExists(prerequisiteCourseId, client))) throw new Error('FK_PROGRAM_COURSE');
  }
}

export async function getProgramCourseDeleteImpact(id) {
  return withPostgresClient(async (client) => {
    const current = await findActiveProgramCourseSummary(id, client);
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

export async function deleteProgramCourse(id, expectedVersion) {
  return withPostgresClient(async (client) => {
    await client.query('BEGIN');
    try {
      const current = await findActiveProgramCourseSummary(id, client);
      if (!current.rowCount) {
        await client.query('ROLLBACK');
        return false;
      }
      await softDeletePrerequisitesForCourses([id], 'Related course deleted', client);
      const { rowCount } = await softDeleteProgramCourse(id, client, expectedVersion?.updatedAt);
      if (!rowCount) {
        await client.query('ROLLBACK');
        if (expectedVersion && (await findActiveProgramCourseSummary(id, client)).rowCount) throw staleWrite();
        return false;
      }
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

export async function updatePrerequisites(programCourseId, prerequisiteCourseIds, expectedUpdatedAt) {
  await withPostgresClient(async (client) => {
    await client.query('BEGIN');
    try {
      const touched = await touchProgramCourse(programCourseId, client, expectedUpdatedAt);
      if (!touched.rowCount) {
        await client.query('ROLLBACK');
        if (expectedUpdatedAt && await programCourseExists(programCourseId, client)) throw staleWrite();
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

export async function addPrerequisiteRelation(programCourseId, prerequisiteCourseId, expectedUpdatedAt) {
  if (Number(programCourseId) === Number(prerequisiteCourseId)) throw new Error('FK_SELF_RELATION');
  try {
    return await withPostgresClient(async (client) => {
      await client.query('BEGIN');
      try {
        const touched = await touchProgramCourse(programCourseId, client, expectedUpdatedAt);
        if (!touched.rowCount && expectedUpdatedAt && await programCourseExists(programCourseId, client)) throw staleWrite();
        const rows = [await createPrerequisiteRow(programCourseId, prerequisiteCourseId, client)];
        await logAdminAction(client, { action: 'Created Relation', entity: 'relation', entityId: rows[0].id, newValues: rows[0], description: 'Created prerequisite relationship' });
        await client.query('COMMIT');
        return mapPrerequisiteRelation(rows[0]);
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      }
    });
  } catch (error) {
    if (duplicate(error)) return null;
    if (String(error?.code) === '23503' || String(error?.code) === '23514') throw new Error('FK_PROGRAM_COURSE');
    throw error;
  }
}

export async function deletePrerequisiteRelation(programCourseId, prerequisiteCourseId, expectedUpdatedAt) {
  return withPostgresClient(async (client) => {
    await client.query('BEGIN');
    try {
      const touched = await touchProgramCourse(programCourseId, client, expectedUpdatedAt);
      if (!touched.rowCount && expectedUpdatedAt && await programCourseExists(programCourseId, client)) throw staleWrite();
      const { rows, rowCount } = await softDeletePrerequisiteRow(programCourseId, prerequisiteCourseId, client);
      if (!rowCount) {
        await client.query('ROLLBACK');
        return false;
      }
      if (rowCount) await logAdminAction(client, { action: 'Deleted Relation', entity: 'relation', entityId: rows[0].id, oldValues: rows[0], description: 'Moved prerequisite relationship to recycle bin' });
      await client.query('COMMIT');
      return rowCount > 0;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    }
  });
}

export async function updatePrerequisiteVisibility(programCourseId, prerequisiteCourseId, visibleToStudents, expectedUpdatedAt) {
  return withPostgresClient(async (client) => {
    await client.query('BEGIN');
    try {
      const touched = await touchProgramCourse(programCourseId, client, expectedUpdatedAt);
      if (!touched.rowCount && expectedUpdatedAt && await programCourseExists(programCourseId, client)) throw staleWrite();
      const { rows, rowCount } = await updatePrerequisiteVisibilityRow(programCourseId, prerequisiteCourseId, visibleToStudents, client);
      if (!rowCount) {
        await client.query('ROLLBACK');
        return false;
      }
      if (rowCount) await logAdminAction(client, { action: visibleToStudents ? 'Restored Relation Visibility' : 'Hidden Relation', entity: 'relation', entityId: rows[0].id, newValues: rows[0], description: `Relation ${visibleToStudents ? 'shown to' : 'hidden from'} students` });
      await client.query('COMMIT');
      return rowCount > 0;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    }
  });
}

export async function getCatalog(options = {}) {
  const [faculties, programs, programCourses] = await Promise.all([
    getFaculties(),
    getPrograms(),
    getProgramCourses({}, options)
  ]);
  return { faculties, programs, programCourses };
}
