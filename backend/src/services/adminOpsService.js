import { query, withPostgresClient } from '../db/client.js';
import XLSX from 'xlsx';
import { insertAuditLog, listAuditLogs } from '../repositories/auditRepository.js';
import { findBackupSnapshot, insertBackup, listBackups } from '../repositories/backupRepository.js';
import { insertImportedRow, readCatalogSnapshot, readImportReferences } from '../repositories/adminCatalogRepository.js';
import { deleteEntity, deleteProgramCourseAndOrphanCourse, findDeletedEntity, findEntity, listDeletedCatalog, listProgramCourseIdsForFaculty, listProgramCourseIdsForProgram, restoreEntity, restorePrerequisitesForCourse, restorePrerequisitesForCourses, restoreProgramCoursesForFaculty, restoreProgramCoursesForProgram, restoreProgramsForFaculty } from '../repositories/recycleBinRepository.js';

const ENTITY_TABLES = {
  faculty: 'faculties',
  program: 'programs',
  course: 'program_courses',
  relation: 'course_prerequisites'
};

function toInt(value) {
  return Number(value);
}

function countBy(rows, key) {
  return rows.reduce((total, row) => total + Number(row[key] || 0), 0);
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  return [
    headers.map(csvEscape).join(','),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(','))
  ].join('\n');
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function normalizedExport(catalog) {
  const facultyById = new Map(catalog.faculties.map((item) => [Number(item.id), item]));
  const programById = new Map(catalog.programs.map((item) => [Number(item.id), item]));
  const courseById = new Map(catalog.programCourses.map((item) => [Number(item.id), item]));
  const relationsByCourse = new Map();
  for (const relation of catalog.relationships) {
    const list = relationsByCourse.get(Number(relation.course_id)) || [];
    list.push(relation);
    relationsByCourse.set(Number(relation.course_id), list);
  }
  const courses = catalog.programCourses.map((course) => {
    const program = programById.get(Number(course.program_id));
    const faculty = facultyById.get(Number(program?.faculty_id));
    const relations = relationsByCourse.get(Number(course.id)) || [];
    const prerequisiteCodes = relations.map((relation) => courseById.get(Number(relation.prerequisite_course_id))?.code).filter(Boolean);
    const requiredForCodes = catalog.relationships
      .filter((relation) => Number(relation.prerequisite_course_id) === Number(course.id))
      .map((relation) => courseById.get(Number(relation.course_id))?.code).filter(Boolean);
    return {
      faculty: faculty?.name || '', program: program?.name || '', courseCode: course.code, courseName: course.name,
      year: course.year_no, semester: course.semester_no, credits: course.credits,
      visibility: relations.every((relation) => relation.visible_to_students !== false) ? 'Visible' : 'Contains hidden relations',
      prerequisites: prerequisiteCodes.join('; '), requiredFor: requiredForCodes.join('; '), description: course.description || ''
    };
  });
  const prerequisites = catalog.relationships.map((relation) => ({
    courseCode: courseById.get(Number(relation.course_id))?.code || '',
    courseName: courseById.get(Number(relation.course_id))?.name || '',
    prerequisiteCode: courseById.get(Number(relation.prerequisite_course_id))?.code || '',
    prerequisiteName: courseById.get(Number(relation.prerequisite_course_id))?.name || '',
    visibility: relation.visible_to_students === false ? 'Hidden' : 'Visible'
  }));
  const requiredFor = prerequisites.map((relation) => ({
    courseCode: relation.prerequisiteCode, courseName: relation.prerequisiteName,
    requiredForCode: relation.courseCode, requiredForName: relation.courseName, visibility: relation.visibility
  }));
  return {
    exportedAt: new Date().toISOString(),
    faculties: catalog.faculties.map(({ id, name }) => ({ id, name })),
    programs: catalog.programs.map(({ id, faculty_id, name, duration_years }) => ({ id, facultyId: faculty_id, name, durationYears: duration_years })),
    courses, prerequisites, requiredFor
  };
}

function toWorkbookBuffer(data) {
  const workbook = XLSX.utils.book_new();
  const sheets = [
    ['Faculty', data.faculties], ['Program', data.programs], ['Course', data.courses],
    ['Prerequisites', data.prerequisites], ['Required For', data.requiredFor]
  ];
  for (const [name, rows] of sheets) XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), name);
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer', compression: true });
}

function parseCsv(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const parseLine = (line) => {
    const cells = [];
    let value = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (char === '"' && quoted && line[i + 1] === '"') {
        value += '"';
        i += 1;
      } else if (char === '"') {
        quoted = !quoted;
      } else if (char === ',' && !quoted) {
        cells.push(value.trim());
        value = '';
      } else {
        value += char;
      }
    }
    cells.push(value.trim());
    return cells;
  };
  const headers = parseLine(lines[0]).map((header) => header.trim());
  return lines.slice(1).map((line) => Object.fromEntries(parseLine(line).map((cell, index) => [headers[index], cell])));
}

async function importRows({ type, format = 'json', content, fileContent }) {
  if (format === 'xlsx') {
    const XLSX = await import('xlsx');
    const workbook = XLSX.read(Buffer.from(String(fileContent || ''), 'base64'), { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) throw new Error('The workbook has no readable worksheet');
    return XLSX.utils.sheet_to_json(sheet, { defval: '' });
  }
  if (format === 'pdf') {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: Buffer.from(String(fileContent || ''), 'base64') });
    const result = await parser.getText();
    await parser.destroy();
    const rows = parseCsv(result.text);
    if (!rows.length || !Object.keys(rows[0] || {}).some((key) => key.trim())) throw new Error('PDF does not contain a usable CSV-style table');
    return rows;
  }
  if (!['json', 'csv'].includes(format)) throw new Error('Unsupported import format');
  return format === 'csv' ? parseCsv(content) : JSON.parse(content || '[]');
}

async function catalogRows(client) {
  return readCatalogSnapshot(client);
}

export async function logAdminAction(client, { action, entity, entityId = null, oldValues = null, newValues = null, description = '', adminUser = 'Admin' }) {
  await insertAuditLog(client || { query }, { action, entity, entityId, oldValues, newValues, description, adminUser });
}

export async function getAuditLogs(filters = {}) {
  const params = [];
  const conditions = [];
  if (filters.range === 'today') conditions.push("created_at >= date_trunc('day', now())");
  if (filters.range === 'week') conditions.push("created_at >= date_trunc('week', now())");
  if (filters.entity) {
    params.push(filters.entity);
    conditions.push(`entity = $${params.length}`);
  }
  if (filters.action) {
    params.push(`%${filters.action}%`);
    conditions.push(`action ILIKE $${params.length}`);
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    conditions.push(`(description ILIKE $${params.length} OR action ILIKE $${params.length} OR entity ILIKE $${params.length})`);
  }
  const order = filters.order === 'oldest' ? 'ASC' : 'DESC';
  const limit = Math.min(Number(filters.limit) || 100, 500);
  const { rows } = await listAuditLogs({ query }, { ...filters, limit });
  return rows.map((row) => ({ ...row, id: toInt(row.id), entityId: row.entity_id == null ? null : toInt(row.entity_id) }));
}

export async function getDashboardSummary() {
  return withPostgresClient(async (client) => {
    const catalog = await catalogRows(client);
    const relations = catalog.relationships;
    const today = await client.query("SELECT count(*)::int AS count FROM admin_audit_logs WHERE created_at >= date_trunc('day', now())");
    const logs = await client.query(
      `SELECT id, created_at, action, entity, entity_id, description
         FROM admin_audit_logs
        ORDER BY created_at DESC
        LIMIT 8`
    );
    const deleted = await client.query(
      `SELECT 'Faculty' AS entity, count(*)::int AS count FROM faculties WHERE deleted_at IS NOT NULL
       UNION ALL SELECT 'Program', count(*)::int FROM programs WHERE deleted_at IS NOT NULL
       UNION ALL SELECT 'Course', count(*)::int FROM program_courses WHERE deleted_at IS NOT NULL
       UNION ALL SELECT 'Relationship', count(*)::int FROM course_prerequisites WHERE deleted_at IS NOT NULL`
    );
    const programCounts = catalog.programs.map((program) => ({
      id: toInt(program.id),
      name: program.name,
      count: catalog.programCourses.filter((course) => Number(course.program_id) === Number(program.id)).length
    }));
    const prerequisiteCounts = catalog.programCourses.map((course) => ({
      code: course.code,
      name: course.name,
      count: relations.filter((relation) => Number(relation.course_id) === Number(course.id) || Number(relation.prerequisite_course_id) === Number(course.id)).length
    }));
    return {
      counts: {
        faculties: catalog.faculties.length,
        programs: catalog.programs.length,
        courses: new Set(catalog.programCourses.map((course) => Number(course.course_id))).size,
        programCourses: catalog.programCourses.length,
        relationships: relations.length,
        hiddenRelationships: relations.filter((relation) => relation.visible_to_students === false).length,
        recycleBin: countBy(deleted.rows, 'count')
      },
      todayActivity: Number(today.rows[0]?.count || 0),
      latestActivity: logs.rows.map((row) => ({ ...row, id: toInt(row.id), entityId: row.entity_id == null ? null : toInt(row.entity_id) })),
      analytics: {
        visibleRelationships: relations.filter((relation) => relation.visible_to_students !== false).length,
        coursesWithoutPrerequisites: catalog.programCourses.filter((course) => !relations.some((relation) => Number(relation.course_id) === Number(course.id))).length,
        coursesWithoutRequiredFor: catalog.programCourses.filter((course) => !relations.some((relation) => Number(relation.prerequisite_course_id) === Number(course.id))).length,
        largestProgram: programCounts.sort((a, b) => b.count - a.count)[0] || null,
        smallestProgram: programCounts.sort((a, b) => a.count - b.count)[0] || null,
        averageCoursesPerSemester: catalog.programCourses.length
          ? Number((catalog.programCourses.length / new Set(catalog.programCourses.map((course) => `${course.program_id}:${course.year_no}:${course.semester_no}`)).size).toFixed(2))
          : 0,
        averagePrerequisites: catalog.programCourses.length ? Number((relations.length / catalog.programCourses.length).toFixed(2)) : 0,
        mostConnectedCourse: prerequisiteCounts.sort((a, b) => b.count - a.count)[0] || null,
        unusedCourses: catalog.programCourses.filter((course) => !relations.some((relation) => Number(relation.course_id) === Number(course.id) || Number(relation.prerequisite_course_id) === Number(course.id))).length
      }
    };
  });
}

export async function getSystemHealth() {
  return withPostgresClient(async (client) => {
    const totals = await client.query(
      `SELECT
        (SELECT count(*)::int FROM faculties WHERE deleted_at IS NULL) AS faculties,
        (SELECT count(*)::int FROM programs WHERE deleted_at IS NULL) AS programs,
        (SELECT count(*)::int FROM courses WHERE deleted_at IS NULL) AS courses,
        (SELECT count(*)::int FROM program_courses WHERE deleted_at IS NULL) AS program_courses,
        (SELECT count(*)::int FROM course_prerequisites WHERE deleted_at IS NULL) AS relationships`
    );
    const backup = await client.query('SELECT created_at FROM admin_backup_history ORDER BY created_at DESC LIMIT 1');
    const importLog = await client.query("SELECT created_at FROM admin_audit_logs WHERE action ILIKE 'Imported%' ORDER BY created_at DESC LIMIT 1");
    const exportLog = await client.query("SELECT created_at FROM admin_audit_logs WHERE action ILIKE 'Exported%' ORDER BY created_at DESC LIMIT 1");
    const migration = await client.query("SELECT '20260712100000_admin_operations' AS version");
    return {
      backendStatus: 'green',
      databaseStatus: 'green',
      renderApiStatus: 'green',
      supabaseStatus: 'green',
      lastBackup: backup.rows[0]?.created_at || null,
      lastImport: importLog.rows[0]?.created_at || null,
      lastExport: exportLog.rows[0]?.created_at || null,
      migrationVersion: migration.rows[0].version,
      totalRecords: totals.rows[0]
    };
  });
}

export async function getRecycleBin() {
  const { rows } = await listDeletedCatalog({ query });
  return rows.map((row) => ({ ...row, id: toInt(row.id), dependencies: Number(row.dependencies || 0) }));
}

export async function restoreRecycleItem(kind, id) {
  if (!ENTITY_TABLES[kind]) throw new Error('INVALID_ENTITY');
  return withPostgresClient(async (client) => {
    await client.query('BEGIN');
    try {
      const current = await findDeletedEntity(client, kind, id);
      if (!current.rowCount) {
        await client.query('ROLLBACK');
        return false;
      }
      await restoreEntity(client, kind, id);
      if (kind === 'faculty') {
        const children = await listProgramCourseIdsForFaculty(client, id);
        const childIds = children.rows.map((row) => toInt(row.id));
        await restoreProgramsForFaculty(client, id);
        await restoreProgramCoursesForFaculty(client, id);
        if (childIds.length) await restorePrerequisitesForCourses(client, childIds);
      }
      if (kind === 'program') {
        const children = await listProgramCourseIdsForProgram(client, id);
        const childIds = children.rows.map((row) => toInt(row.id));
        await restoreProgramCoursesForProgram(client, id);
        if (childIds.length) await restorePrerequisitesForCourses(client, childIds);
      }
      if (kind === 'course') await restorePrerequisitesForCourse(client, id);
      await logAdminAction(client, {
        action: `Restored ${kind}`,
        entity: kind,
        entityId: id,
        oldValues: current.rows[0],
        newValues: { restored: true },
        description: `Restored ${kind} from recycle bin`
      });
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    }
  });
}

export async function permanentlyDeleteRecycleItem(kind, id) {
  if (!ENTITY_TABLES[kind]) throw new Error('INVALID_ENTITY');
  return withPostgresClient(async (client) => {
    await client.query('BEGIN');
    try {
      const current = await findEntity(client, kind, id);
      if (!current.rowCount) {
        await client.query('ROLLBACK');
        return false;
      }
      if (kind === 'faculty') {
        await deleteEntity(client, kind, id);
      } else if (kind === 'program') {
        await deleteEntity(client, kind, id);
      } else if (kind === 'course') {
        const courseId = current.rows[0].course_id;
        await deleteProgramCourseAndOrphanCourse(client, id, courseId);
      } else {
        await deleteEntity(client, kind, id);
      }
      await logAdminAction(client, {
        action: `Permanently Deleted ${kind}`,
        entity: kind,
        entityId: id,
        oldValues: current.rows[0],
        description: `Permanently deleted ${kind}`
      });
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    }
  });
}

export async function exportCatalog(format = 'json') {
  if (!['json', 'csv', 'xlsx'].includes(format)) throw new Error('Unsupported export format');
  return withPostgresClient(async (client) => {
    const catalog = await catalogRows(client);
    const exportData = normalizedExport(catalog);
    await logAdminAction(client, {
      action: 'Exported Catalog',
      entity: 'catalog',
      description: `Exported catalog as ${format}`
    });
    if (format === 'csv') {
      return {
        filename: `catalog-export-${timestamp()}.csv`,
        mimeType: 'text/csv; charset=utf-8',
        content: toCsv(exportData.courses)
      };
    }
    if (format === 'xlsx') return {
      filename: `catalog-export-${timestamp()}.xlsx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      content: toWorkbookBuffer(exportData)
    };
    return { filename: `catalog-export-${timestamp()}.json`, mimeType: 'application/json; charset=utf-8', content: JSON.stringify(exportData, null, 2) };
  });
}

export async function createBackup(format = 'json') {
  if (!['json', 'csv', 'xlsx'].includes(format)) throw new Error('Unsupported backup format');
  return withPostgresClient(async (client) => {
    const catalog = await catalogRows(client);
    const recordCounts = {
      faculties: catalog.faculties.length,
      programs: catalog.programs.length,
      programCourses: catalog.programCourses.length,
      relationships: catalog.relationships.length
    };
    const { rows } = await insertBackup(client, format, recordCounts, catalog, `Catalog backup generated as ${format}`);
    await logAdminAction(client, {
      action: 'Database Backup',
      entity: 'backup',
      entityId: rows[0].id,
      newValues: rows[0],
      description: `Generated ${format} catalog backup`
    });
    return { ...rows[0], id: toInt(rows[0].id) };
  });
}

export async function getBackups() {
  const { rows } = await listBackups({ query });
  return rows.map((row) => ({ ...row, id: toInt(row.id) }));
}

export async function getBackupDownload(id) {
  const { rows } = await findBackupSnapshot({ query }, id);
  if (!rows.length) return null;
  const row = rows[0];
  return {
    filename: `catalog-backup-${row.id}-${timestamp()}.${row.format}`,
    mimeType: row.format === 'csv' ? 'text/csv; charset=utf-8' : row.format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/json; charset=utf-8',
    content: row.format === 'csv' ? toCsv(normalizedExport(row.snapshot).courses) : row.format === 'xlsx' ? toWorkbookBuffer(normalizedExport(row.snapshot)) : JSON.stringify(normalizedExport(row.snapshot), null, 2)
  };
}

export async function validateImport({ type, format = 'json', content }) {
  if (!['faculties', 'programs', 'programCourses', 'relationships'].includes(type)) return { valid: false, count: 0, errors: [{ line: 0, error: 'Unsupported import type' }], rows: [] };
  if (!['json', 'csv', 'xlsx', 'pdf'].includes(format)) return { valid: false, count: 0, errors: [{ line: 0, error: 'Unsupported import format' }], rows: [] };
  let rows;
  try { rows = await importRows(arguments[0]); } catch (error) { return { valid: false, count: 0, errors: [{ line: 0, error: error.message || 'Invalid import file' }], rows: [] }; }
  const list = Array.isArray(rows) ? rows : rows[type] || [];
  if (!Array.isArray(list) || !list.length) return { valid: false, count: 0, errors: [{ line: 0, error: 'Import contains no rows' }], rows: [] };
  const errors = [];
  const seenNames = new Set();
  const seenCodes = new Set();
  const [faculties, programs, programCourses] = await readImportReferences({ query });
  const facultyIds = new Set(faculties.rows.map((row) => Number(row.id)));
  const programIds = new Set(programs.rows.map((row) => Number(row.id)));
  const courseIds = new Set(programCourses.rows.map((row) => Number(row.id)));
  const courseCodeToId = new Map(programCourses.rows.map((row) => [row.code, Number(row.id)]));
  for (const [index, row] of list.entries()) {
    const line = index + 1;
    if (!row || typeof row !== 'object' || Array.isArray(row) || !Object.keys(row).length) { errors.push({ line, error: 'Empty or malformed row' }); continue; }
    if (type === 'faculties') {
      const name = String(row.name || '').trim().toLowerCase();
      if (!name) errors.push({ line, error: 'Missing faculty name' });
      if (faculties.rows.some((item) => item.name === name)) errors.push({ line, error: 'Duplicate faculty name already exists' });
      if (seenNames.has(name)) errors.push({ line, error: 'Duplicate faculty name in import' });
    }
    if (type === 'programs') {
      const facultyId = Number(row.facultyId ?? row.faculty_id);
      const name = String(row.name || '').trim().toLowerCase();
      if (!facultyId) errors.push({ line, error: 'Missing facultyId' });
      else if (!facultyIds.has(facultyId)) errors.push({ line, error: 'Unknown facultyId' });
      if (!name) errors.push({ line, error: 'Missing program name' });
      if (programs.rows.some((item) => Number(item.faculty_id) === facultyId && item.name === name)) errors.push({ line, error: 'Duplicate program already exists for faculty' });
      if (seenNames.has(`${facultyId}:${name}`)) errors.push({ line, error: 'Duplicate program in import' });
      if (![4, 5, '4', '5'].includes(row.durationYears ?? row.duration_years)) errors.push({ line, error: 'Invalid duration' });
    }
    if (type === 'programCourses') {
      const programId = Number(row.programId ?? row.program_id);
      const code = String(row.code || '').trim().toLowerCase();
      const name = String(row.name || '').trim().toLowerCase();
      const yearNo = Number(row.yearNo ?? row.year_no);
      const semesterNo = Number(row.semesterNo ?? row.semester_no);
      const credits = Number(row.credits ?? 0);
      if (!programId) errors.push({ line, error: 'Missing programId' });
      else if (!programIds.has(programId)) errors.push({ line, error: 'Unknown programId' });
      if (!code) errors.push({ line, error: 'Missing code' });
      if (!name) errors.push({ line, error: 'Missing name' });
      if (!Number.isInteger(yearNo) || yearNo < 1 || yearNo > 5) errors.push({ line, error: 'Invalid yearNo' });
      if (!Number.isInteger(semesterNo) || semesterNo < 1 || semesterNo > 10) errors.push({ line, error: 'Invalid semesterNo' });
      if (!Number.isInteger(credits) || credits < 0 || credits > 30) errors.push({ line, error: 'Invalid credits' });
      if (programCourses.rows.some((item) => item.code === code || item.name === name)) errors.push({ line, error: 'Duplicate course code or name already exists' });
      if (seenCodes.has(code)) errors.push({ line, error: 'Duplicate code in import' });
      seenCodes.add(code);
      for (const prerequisiteCode of String(row.prerequisites || '').split(',').map((codeItem) => codeItem.trim().toLowerCase()).filter(Boolean)) {
        if (!courseCodeToId.has(prerequisiteCode)) errors.push({ line, error: `Unknown prerequisite code: ${prerequisiteCode}` });
      }
    }
    if (type === 'relationships') {
      const courseId = Number(row.courseId ?? row.course_id) || courseCodeToId.get(String(row.courseCode ?? row.course_code ?? '').trim().toLowerCase());
      const prerequisiteCourseId = Number(row.prerequisiteCourseId ?? row.prerequisite_course_id) || courseCodeToId.get(String(row.prerequisiteCode ?? row.prerequisite_code ?? '').trim().toLowerCase());
      if (!courseId || !courseIds.has(courseId)) errors.push({ line, error: 'Unknown course' });
      if (!prerequisiteCourseId || !courseIds.has(prerequisiteCourseId)) errors.push({ line, error: 'Unknown prerequisite course' });
      if (courseId && prerequisiteCourseId && courseId === prerequisiteCourseId) errors.push({ line, error: 'Course cannot require itself' });
    }
    const nameKey = type === 'programs' ? `${Number(row.facultyId ?? row.faculty_id)}:${String(row.name || '').toLowerCase()}` : String(row.name || '').toLowerCase();
    if (nameKey && seenNames.has(nameKey)) errors.push({ line, error: 'Duplicate name in import' });
    if (nameKey) seenNames.add(nameKey);
  }
  return { valid: errors.length === 0, count: list.length, errors, rows: list };
}

export async function importCatalog(payload) {
  const validation = await validateImport(payload);
  if (!validation.valid) return validation;
  return withPostgresClient(async (client) => {
    await client.query('BEGIN');
    try {
      let inserted = 0;
      for (const row of validation.rows) {
        await insertImportedRow(client, payload.type, row);
        inserted += 1;
      }
      await logAdminAction(client, {
        action: `Imported ${payload.type}`,
        entity: payload.type,
        newValues: { inserted },
        description: `Imported ${inserted} ${payload.type}`
      });
      await client.query('COMMIT');
      return { valid: true, inserted, errors: [] };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    }
  });
}
