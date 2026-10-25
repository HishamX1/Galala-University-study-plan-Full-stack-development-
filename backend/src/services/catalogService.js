import { query, withPostgresClient } from '../db/client.js';
import { logAdminAction } from './adminOpsService.js';
import { findActiveFaculty, insertFaculty, listActiveFaculties, listActiveFacultyProgramCourseIds, softDeleteFaculty, updateActiveFaculty } from '../repositories/facultyRepository.js';
import { findActiveProgram, insertProgram, listActivePrograms, softDeleteProgram, softDeleteProgramsForFaculty, updateActiveProgram } from '../repositories/programRepository.js';
import { findActiveProgramCourseDetail, findActiveProgramCourseSummary, findDuplicateProgramCourse, findProgramCourseWithCourse, insertProgramCourse, listActiveProgramCourseSummaries, listActiveProgramCourses, programCourseExists, programCourseRecordExists, softDeleteProgramCourse, softDeleteProgramCourses, touchProgramCourse, updateProgramCourseRow } from '../repositories/programCourseRepository.js';
import { updateCourse, upsertCourse } from '../repositories/courseRepository.js';
import { createPrerequisiteRow, listActivePrerequisiteRows, listPrerequisiteGroupRows, listRelationshipImpactRows, softDeletePrerequisiteRow, softDeletePrerequisitesForCourses, updatePrerequisiteVisibilityRow } from '../repositories/prerequisiteRepository.js';
import { AppError } from '../utils/errors.js';
import { CatalogRevisionChangedError, createRevisionedCatalogCache } from './catalogCache.js';

async function readCatalogRevision() {
  const result = await query('SELECT public.get_catalog_revision()::text AS revision');
  if (!result.rows[0]?.revision) throw new Error('CATALOG_REVISION_UNAVAILABLE');
  return result.rows[0].revision;
}

async function buildCatalogSnapshot(audience) {
  const options = { includeHidden: audience === 'admin' };
  const [faculties, programs, programCourses] = await Promise.all([
    getFaculties(),
    getPrograms(),
    getProgramCourses({}, options)
  ]);
  return { faculties, programs, programCourses };
}

const catalogCache = createRevisionedCatalogCache({
  readRevision: readCatalogRevision,
  buildCatalog: buildCatalogSnapshot
});

function duplicate(error) {
  return String(error?.code) === '23505';
}

function cleanText(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function deletedBy(actor) {
  return String(actor?.name || actor?.email || actor?.id || 'Admin').slice(0, 200);
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

export async function createFaculty(data, actor = null) {
  try {
    return await withPostgresClient(async (client) => {
      await client.query('BEGIN');
      try {
        const created = await insertFaculty(data.name.trim(), client);
        await logAdminAction(client, { action: 'Created Faculty', entity: 'faculty', entityId: created.id, newValues: created, description: `Created faculty ${created.name}`, actor });
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

export async function updateFaculty(id, data, actor = null) {
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
        await logAdminAction(client, { action: 'Updated Faculty', entity: 'faculty', entityId: id, oldValues: current.rows[0], newValues: rows[0], description: `Updated faculty ${rows[0].name}`, actor });
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

export async function deleteFaculty(id, expectedVersion, actor = null) {
  return withPostgresClient(async (client) => {
    await client.query('BEGIN');
    try {
      const current = await findActiveFaculty(id, client);
      if (!current.rowCount) {
        await client.query('ROLLBACK');
        return false;
      }
      const childCourseIds = (await listActiveFacultyProgramCourseIds(id, client)).map((row) => toInt(row.id));
      const deleter = deletedBy(actor);
      if (childCourseIds.length) {
        await softDeletePrerequisitesForCourses(childCourseIds, 'Parent faculty deleted', client, deleter);
        await softDeleteProgramCourses(childCourseIds, 'Parent faculty deleted', client, deleter);
      }
      await softDeleteProgramsForFaculty(id, client, deleter);
      const { rowCount } = await softDeleteFaculty(id, client, expectedVersion?.updatedAt, deleter);
      if (!rowCount) {
        await client.query('ROLLBACK');
        if (expectedVersion && (await findActiveFaculty(id, client)).rowCount) throw staleWrite();
        return false;
      }
      await logAdminAction(client, { action: 'Deleted Faculty', entity: 'faculty', entityId: id, oldValues: current.rows[0], description: `Moved faculty ${current.rows[0].name} to recycle bin`, actor });
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

export async function createProgram(data, actor = null) {
  try {
    return await withPostgresClient(async (client) => {
      await client.query('BEGIN');
      try {
        const created = await insertProgram(data, client);
        await logAdminAction(client, { action: 'Created Program', entity: 'program', entityId: created.id, newValues: created, description: `Created program ${created.name}`, actor });
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

export async function updateProgram(id, data, actor = null) {
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
        await logAdminAction(client, { action: 'Updated Program', entity: 'program', entityId: id, newValues: rows[0], description: `Updated program ${rows[0].name}`, actor });
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

export async function deleteProgram(id, expectedVersion, actor = null) {
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
      const deleter = deletedBy(actor);
      if (programCourseIds.length) {
        await softDeletePrerequisitesForCourses(programCourseIds, 'Parent program deleted', client, deleter);
        await softDeleteProgramCourses(programCourseIds, 'Parent program deleted', client, deleter);
      }
      const { rowCount } = await softDeleteProgram(id, client, expectedVersion?.updatedAt, deleter);
      if (!rowCount) {
        await client.query('ROLLBACK');
        if (expectedVersion && (await findActiveProgram(id, client)).rowCount) throw staleWrite();
        return false;
      }
      await logAdminAction(client, { action: 'Deleted Program', entity: 'program', entityId: id, oldValues: current.rows[0], description: `Moved program ${current.rows[0].name} to recycle bin`, actor });
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
  const groupRows = await listPrerequisiteGroupRows(rows.map((row) => row.id), options.includeHidden === true, { query });
  const groupsByCourse = new Map();
  for (const item of groupRows) {
    const courseId = toInt(item.course_id);
    const groups = groupsByCourse.get(courseId) || new Map();
    const group = groups.get(toInt(item.group_id)) || { id: toInt(item.group_id), type: item.group_type, label: item.label, position: toInt(item.position), members: [] };
    group.members.push({ courseId: toInt(item.prerequisite_course_id), minimumGrade: item.minimum_grade, position: toInt(item.member_position) });
    groups.set(toInt(item.group_id), group);
    groupsByCourse.set(courseId, groups);
  }
  return rows.map((row) => ({ ...mapProgramCourse(row, prereqs.get(toInt(row.id)) || []), prerequisiteGroups: [...(groupsByCourse.get(toInt(row.id))?.values() || [])] }));
}

export async function createProgramCourse(data, actor = null) {
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
        await logAdminAction(client, { action: 'Created Course', entity: 'course', entityId: programCourse.id, newValues: { ...data, id: programCourse.id }, description: `Created course ${data.code.trim().toUpperCase()}`, actor });
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

function normalizePrerequisiteGroups(body, courseId) {
  const mandatory=body?.mandatoryCourseIds; const alternatives=body?.alternativeGroups;
  if(!Array.isArray(mandatory)||!Array.isArray(alternatives)||alternatives.some(group=>!group||typeof group.label!=='string'||!group.label.trim()||group.label.trim().length>120||!Array.isArray(group.prerequisiteCourseIds)||group.prerequisiteCourseIds.length<2)) throw new AppError('Invalid prerequisite groups.',400,'VALIDATION_ERROR');
  const allIds=[...mandatory.map(Number),...alternatives.flatMap(group=>group.prerequisiteCourseIds.map(Number))];
  if(allIds.some(id=>!Number.isInteger(id)||id<=0)||new Set(allIds).size!==allIds.length||allIds.includes(Number(courseId))) throw new AppError('Invalid prerequisite course selection.',400,'VALIDATION_ERROR');
  return {mandatory:mandatory.map(Number),alternatives,allIds};
}

async function persistPrerequisiteGroups(client,courseId,body,{recordAudit=false,actor=null}={}) {
  const {mandatory,alternatives,allIds}=normalizePrerequisiteGroups(body,courseId);
  const target=await client.query('SELECT program_id FROM public.program_courses WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[courseId]);
  if(!target.rowCount) return false;
  if(allIds.length) {
    const valid=await client.query('SELECT id FROM public.program_courses WHERE id=ANY($1::bigint[]) AND program_id=$2 AND deleted_at IS NULL',[allIds,target.rows[0].program_id]);
    if(valid.rowCount!==allIds.length) throw new AppError('Prerequisites must be active courses in the same program.',400,'INVALID_PREREQUISITE');
    await assertNoPrerequisiteCycle(client,courseId,allIds);
  }
  const previous=await client.query('SELECT prerequisite_course_id,visible_to_students FROM public.course_prerequisites WHERE course_id=$1',[courseId]);
  const visibility=new Map(previous.rows.map(row=>[Number(row.prerequisite_course_id),row.visible_to_students!==false]));
  await client.query('DELETE FROM public.course_prerequisite_groups WHERE course_id=$1',[courseId]);
  await client.query('DELETE FROM public.course_prerequisites WHERE course_id=$1',[courseId]);
  const saveGroup=async(type,label,members,position)=>{
    const inserted=await client.query('INSERT INTO public.course_prerequisite_groups(course_id,group_type,label,position) VALUES($1,$2,$3,$4) RETURNING id',[courseId,type,label,position]);
    for(let i=0;i<members.length;i+=1){
      const relation=await client.query('INSERT INTO public.course_prerequisites(course_id,prerequisite_course_id,visible_to_students) VALUES($1,$2,$3) RETURNING id',[courseId,members[i],visibility.get(members[i])??true]);
      await client.query('INSERT INTO public.course_prerequisite_group_members(group_id,prerequisite_course_id,position,minimum_grade) VALUES($1,$2,$3,$4)',[inserted.rows[0].id,members[i],i,null]);
      if(type==='mandatory') await client.query('UPDATE public.course_prerequisite_groups SET legacy_relation_id=$2 WHERE id=$1',[inserted.rows[0].id,relation.rows[0].id]);
    }
  };
  for(let i=0;i<mandatory.length;i+=1) await saveGroup('mandatory','Required prerequisite',[mandatory[i]],i);
  for(let i=0;i<alternatives.length;i+=1) await saveGroup('alternative',alternatives[i].label.trim(),alternatives[i].prerequisiteCourseIds.map(Number),mandatory.length+i);
  if(recordAudit) await logAdminAction(client,{action:'Updated Prerequisite Groups',entity:'relation',entityId:courseId,newValues:body,description:'Updated mandatory and alternative prerequisite groups',actor});
  return true;
}

async function assertNoPrerequisiteCycle(client,courseId,prerequisiteIds) {
  if(!prerequisiteIds.length) return;
  const result=await client.query(`WITH RECURSIVE walk(id,path) AS (
    SELECT requested.id,ARRAY[requested.id]::bigint[] FROM unnest($1::bigint[]) AS requested(id)
    UNION ALL SELECT cp.prerequisite_course_id,walk.path||cp.prerequisite_course_id
      FROM walk JOIN public.course_prerequisites cp ON cp.course_id=walk.id AND cp.deleted_at IS NULL
      WHERE cp.course_id<>$2 AND NOT cp.prerequisite_course_id=ANY(walk.path)
  ) SELECT 1 FROM walk WHERE id=$2 LIMIT 1`,[prerequisiteIds,courseId]);
  if(result.rowCount) throw new AppError('Prerequisite selection would create a cycle.',400,'INVALID_PREREQUISITE');
}

export async function updateProgramCourse(id, data, actor = null) {
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

        if (data.prerequisiteGroups !== undefined) {
          const saved=await persistPrerequisiteGroups(client,id,data.prerequisiteGroups);
          if(!saved) throw new AppError('Program course not found.',404,'NOT_FOUND');
        } else if (Array.isArray(data.prerequisiteCourseIds)) {
          await replacePrerequisites(client, id, data.prerequisiteCourseIds);
        }

        const { expectedVersion: _expectedVersion, ...auditValues } = data;
        await logAdminAction(client, { action: 'Updated Course', entity: 'course', entityId: id, oldValues: current.rows[0], newValues: auditValues, description: `Updated course ${data.code || current.rows[0].code}`, actor });
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
  await assertNoPrerequisiteCycle(client,courseId,ids);
  const previous=await client.query('SELECT prerequisite_course_id,visible_to_students FROM public.course_prerequisites WHERE course_id=$1',[courseId]);
  const visibility=new Map(previous.rows.map(row=>[Number(row.prerequisite_course_id),row.visible_to_students!==false]));
  await client.query('DELETE FROM public.course_prerequisite_groups WHERE course_id=$1',[courseId]);
  await client.query('DELETE FROM public.course_prerequisites WHERE course_id=$1',[courseId]);
  for (const prerequisiteCourseId of ids) {
    if (!(await programCourseRecordExists(prerequisiteCourseId, client))) throw new Error('FK_PROGRAM_COURSE');
  }
  for (let position=0;position<ids.length;position+=1) {
    const relation=await client.query('INSERT INTO public.course_prerequisites(course_id,prerequisite_course_id,visible_to_students) VALUES($1,$2,$3) RETURNING id',[courseId,ids[position],visibility.get(ids[position])??true]);
    const group=await client.query("INSERT INTO public.course_prerequisite_groups(course_id,group_type,label,position,legacy_relation_id) VALUES($1,'mandatory','Required prerequisite',$2,$3) RETURNING id",[courseId,position,relation.rows[0].id]);
    await client.query('INSERT INTO public.course_prerequisite_group_members(group_id,prerequisite_course_id,position) VALUES($1,$2,0)',[group.rows[0].id,ids[position]]);
  }
}

export async function updatePrerequisiteGroups(courseId, body, actor = null) {
  return withPostgresClient(async (client) => {
    await client.query('BEGIN');
    try {
      const saved=await persistPrerequisiteGroups(client,courseId,body,{recordAudit:true,actor});
      if(!saved) { await client.query('ROLLBACK'); return false; }
      await client.query('COMMIT');
      return getProgramCourseById(courseId);
    } catch(error) { await client.query('ROLLBACK').catch(()=>{}); throw error; }
  });
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

export async function deleteProgramCourse(id, expectedVersion, actor = null) {
  return withPostgresClient(async (client) => {
    await client.query('BEGIN');
    try {
      const current = await findActiveProgramCourseSummary(id, client);
      if (!current.rowCount) {
        await client.query('ROLLBACK');
        return false;
      }
      const deleter = deletedBy(actor);
      await softDeletePrerequisitesForCourses([id], 'Related course deleted', client, deleter);
      const { rowCount } = await softDeleteProgramCourse(id, client, expectedVersion?.updatedAt, deleter);
      if (!rowCount) {
        await client.query('ROLLBACK');
        if (expectedVersion && (await findActiveProgramCourseSummary(id, client)).rowCount) throw staleWrite();
        return false;
      }
      await logAdminAction(client, { action: 'Deleted Course', entity: 'course', entityId: id, oldValues: current.rows[0], description: `Moved course ${current.rows[0].code} to recycle bin`, actor });
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

export async function updatePrerequisites(programCourseId, prerequisiteCourseIds, expectedUpdatedAt, actor = null) {
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
      await logAdminAction(client, { action: 'Updated Prerequisites', entity: 'relation', entityId: programCourseId, newValues: { prerequisiteCourseIds }, description: 'Replaced prerequisite relationships', actor });
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    }
  });
  return getPrerequisites(programCourseId);
}

export async function addPrerequisiteRelation(programCourseId, prerequisiteCourseId, expectedUpdatedAt, actor = null) {
  if (Number(programCourseId) === Number(prerequisiteCourseId)) throw new Error('FK_SELF_RELATION');
  try {
    return await withPostgresClient(async (client) => {
      await client.query('BEGIN');
      try {
        const touched = await touchProgramCourse(programCourseId, client, expectedUpdatedAt);
        if (!touched.rowCount && expectedUpdatedAt && await programCourseExists(programCourseId, client)) throw staleWrite();
        await assertNoPrerequisiteCycle(client,programCourseId,[Number(prerequisiteCourseId)]);
        const rows = [await createPrerequisiteRow(programCourseId, prerequisiteCourseId, client)];
        const group=await client.query("INSERT INTO public.course_prerequisite_groups(course_id,group_type,label,legacy_relation_id) VALUES($1,'mandatory','Required prerequisite',$2) RETURNING id",[programCourseId,rows[0].id]);
        await client.query('INSERT INTO public.course_prerequisite_group_members(group_id,prerequisite_course_id,position) VALUES($1,$2,0)',[group.rows[0].id,prerequisiteCourseId]);
        await logAdminAction(client, { action: 'Created Relation', entity: 'relation', entityId: rows[0].id, newValues: rows[0], description: 'Created prerequisite relationship', actor });
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

export async function deletePrerequisiteRelation(programCourseId, prerequisiteCourseId, expectedUpdatedAt, actor = null) {
  return withPostgresClient(async (client) => {
    await client.query('BEGIN');
    try {
      const touched = await touchProgramCourse(programCourseId, client, expectedUpdatedAt);
      if (!touched.rowCount && expectedUpdatedAt && await programCourseExists(programCourseId, client)) throw staleWrite();
      const { rows, rowCount } = await softDeletePrerequisiteRow(programCourseId, prerequisiteCourseId, client, deletedBy(actor));
      if (!rowCount) {
        await client.query('ROLLBACK');
        return false;
      }
      if (rowCount) await logAdminAction(client, { action: 'Deleted Relation', entity: 'relation', entityId: rows[0].id, oldValues: rows[0], description: 'Moved prerequisite relationship to recycle bin', actor });
      await client.query('COMMIT');
      return rowCount > 0;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    }
  });
}

export async function updatePrerequisiteVisibility(programCourseId, prerequisiteCourseId, visibleToStudents, expectedUpdatedAt, actor = null) {
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
      if (rowCount) await logAdminAction(client, { action: visibleToStudents ? 'Restored Relation Visibility' : 'Hidden Relation', entity: 'relation', entityId: rows[0].id, newValues: rows[0], description: `Relation ${visibleToStudents ? 'shown to' : 'hidden from'} students`, actor });
      await client.query('COMMIT');
      return rowCount > 0;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    }
  });
}

export async function getCatalog(options = {}) {
  const audience = options.includeHidden === true ? 'admin' : 'student';
  try {
    return await catalogCache.getCatalog(audience);
  } catch (error) {
    if (error instanceof CatalogRevisionChangedError) {
      throw new AppError('The catalog changed repeatedly while it was being loaded. Please retry.', 503, 'CATALOG_CHANGED');
    }
    throw error;
  }
}
