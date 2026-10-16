import crypto from 'node:crypto';
import { query, withPostgresClient } from '../db/client.js';
import ExcelJS from 'exceljs';
import { parseXlsxInWorker, XLSX_PARSER_LIMITS } from './xlsxImportParser.js';
import { countTodayAuditEvents, findLatestAuditEvent, insertAuditLog, listAuditLogs, listRecentAuditEvents } from '../repositories/auditRepository.js';
import { findBackupSnapshot, findLatestBackupCreatedAt, insertBackup, listBackups } from '../repositories/backupRepository.js';
import { countActiveCatalogEntities, countDeletedCatalogEntities, insertImportedRow, readCatalogSnapshot, readImportReferences } from '../repositories/adminCatalogRepository.js';
import { cancelCatalogImportStage, countActiveCatalogImportStages, deleteExpiredCatalogImportStages, findCatalogImportStageForOwner, insertCatalogImportStage, listCatalogImportStagesForOwner, lockCatalogImportStageOwner, markCatalogImportStagePublished, refreshCatalogImportStagePreview } from '../repositories/catalogImportStageRepository.js';
import { deleteEntity, deleteProgramCourseAndOrphanCourse, findDeletedEntity, listDeletedCatalog, listProgramCourseIdsForFaculty, listProgramCourseIdsForProgram, restoreEntity, restorePrerequisitesForCourse, restorePrerequisitesForCourses, restoreProgramCoursesForFaculty, restoreProgramCoursesForProgram, restoreProgramsForFaculty } from '../repositories/recycleBinRepository.js';
import { AppError, ConflictError, NotFoundError } from '../utils/errors.js';

const ENTITY_TABLES = {
  faculty: 'faculties',
  program: 'programs',
  course: 'program_courses',
  relation: 'course_prerequisites'
};

const ADMIN_OPERATIONS_MIGRATION_VERSION = '20260712100000_admin_operations';

export const IMPORT_LIMITS = Object.freeze({
  maxFileBytes: XLSX_PARSER_LIMITS.maxFileBytes,
  maxWorksheets: 1,
  maxRows: 10_000,
  maxColumns: 100,
  maxCells: 100_000,
  maxStoredBytes: 8 * 1024 * 1024,
  maxValidationErrors: 500,
  maxActiveStagesPerAdmin: 5,
  stageTtlHours: 24
});

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

async function toWorkbookBuffer(data) {
  const workbook = new ExcelJS.Workbook();
  const sheets = [
    ['Faculty', data.faculties], ['Program', data.programs], ['Course', data.courses],
    ['Prerequisites', data.prerequisites], ['Required For', data.requiredFor]
  ];
  for (const [name, rows] of sheets) {
    const worksheet = workbook.addWorksheet(name);
    if (rows.length) {
      worksheet.columns = Object.keys(rows[0]).map((key) => ({ header: key, key }));
      rows.forEach((row) => worksheet.addRow(row));
    }
  }
  return workbook.xlsx.writeBuffer({ useStyles: false, useSharedStrings: false });
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

export async function importRows({ type, format = 'json', content, fileContent }) {
  if (format === 'xlsx') {
    const encoded = String(fileContent || '');
    const buffer = Buffer.from(encoded, 'base64');
    if (!encoded || buffer.length === 0 || buffer.length > IMPORT_LIMITS.maxFileBytes) throw new Error('Import file exceeds the 5 MB limit');
    return parseXlsxInWorker(buffer);
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
  const limit = Math.min(Number(filters.limit) || 100, 500);
  const { rows } = await listAuditLogs({ query }, { ...filters, limit });
  return rows.map((row) => ({ ...row, id: toInt(row.id), entityId: row.entity_id == null ? null : toInt(row.entity_id) }));
}

export async function getDashboardSummary() {
  return withPostgresClient(async (client) => {
    const catalog = await catalogRows(client);
    const relations = catalog.relationships;
    const today = await countTodayAuditEvents(client);
    const logs = await listRecentAuditEvents(client);
    const deleted = await countDeletedCatalogEntities(client);
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
    const totals = await countActiveCatalogEntities(client);
    const backup = await findLatestBackupCreatedAt(client);
    const importLog = await findLatestAuditEvent(client, 'Imported');
    const exportLog = await findLatestAuditEvent(client, 'Exported');
    return {
      backendStatus: 'green',
      databaseStatus: 'green',
      renderApiStatus: 'green',
      supabaseStatus: 'green',
      lastBackup: backup.rows[0]?.created_at || null,
      lastImport: importLog.rows[0]?.created_at || null,
      lastExport: exportLog.rows[0]?.created_at || null,
      migrationVersion: ADMIN_OPERATIONS_MIGRATION_VERSION,
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
      const current = await findDeletedEntity(client, kind, id);
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
      content: await toWorkbookBuffer(exportData)
    };
    return { filename: `catalog-export-${timestamp()}.json`, mimeType: 'application/json; charset=utf-8', content: JSON.stringify(exportData, null, 2) };
  });
}

export async function createBackup(format = 'json') {
  if (!['json', 'csv', 'xlsx'].includes(format)) throw new Error('Unsupported backup format');
  return withPostgresClient(async (client) => {
    await client.query('BEGIN');
    try {
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
      await client.query('COMMIT');
      return { ...rows[0], id: toInt(rows[0].id) };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    }
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
    content: row.format === 'csv' ? toCsv(normalizedExport(row.snapshot).courses) : row.format === 'xlsx' ? await toWorkbookBuffer(normalizedExport(row.snapshot)) : JSON.stringify(normalizedExport(row.snapshot), null, 2)
  };
}

function validationFailure(error) {
  return { valid: false, count: 0, errors: [{ line: 0, error }], rows: [] };
}

function addImportError(errors, line, error, maxErrors = Infinity) {
  if (errors.length < maxErrors) errors.push({ line, error });
  else errors.truncated = true;
}

function referenceFingerprint(references) {
  const stable = references.map((result) => result.rows
    .slice()
    .sort((left, right) => Number(left.id) - Number(right.id)));
  return crypto.createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

function importPreviewFingerprint(rows, validation, referencesHash) {
  return crypto.createHash('sha256').update(JSON.stringify({
    rows,
    valid: validation.valid,
    count: validation.count,
    errors: validation.errors,
    referencesHash
  })).digest('hex');
}

function validateParsedRows(list) {
  if (!Array.isArray(list) || !list.length) return validationFailure('Import contains no rows');
  if (list.length > IMPORT_LIMITS.maxRows) return validationFailure(`Import exceeds the ${IMPORT_LIMITS.maxRows} row limit`);
  let cellCount = 0;
  for (const [index, row] of list.entries()) {
    const columns = row && typeof row === 'object' && !Array.isArray(row) ? Object.keys(row).length : 0;
    if (columns > IMPORT_LIMITS.maxColumns) return validationFailure(`Row ${index + 1} exceeds the ${IMPORT_LIMITS.maxColumns} column limit`);
    cellCount += columns;
    if (cellCount > IMPORT_LIMITS.maxCells) return validationFailure(`Import exceeds the ${IMPORT_LIMITS.maxCells} cell limit`);
  }
  return null;
}

async function validateImportRows(type, list, executor, maxErrors = Infinity) {
  const sizeError = validateParsedRows(list);
  if (sizeError) return { validation: sizeError, referencesHash: crypto.createHash('sha256').update('no-reference-lookup').digest('hex') };
  const errors = [];
  const seenNames = new Set();
  const seenCodes = new Set();
  const [faculties, programs, programCourses, relationships] = await readImportReferences(executor);
  const referencesHash = referenceFingerprint([faculties, programs, programCourses, relationships]);
  const facultyIds = new Set(faculties.rows.map((row) => Number(row.id)));
  const programIds = new Set(programs.rows.map((row) => Number(row.id)));
  const courseIds = new Set(programCourses.rows.map((row) => Number(row.id)));
  const courseCodeToId = new Map(programCourses.rows.map((row) => [row.code, Number(row.id)]));
  for (const [index, row] of list.entries()) {
    const line = index + 1;
    if (!row || typeof row !== 'object' || Array.isArray(row) || !Object.keys(row).length) { addImportError(errors, line, 'Empty or malformed row', maxErrors); continue; }
    if (type === 'faculties') {
      const name = String(row.name || '').trim().toLowerCase();
      if (!name) addImportError(errors, line, 'Missing faculty name', maxErrors);
      if (faculties.rows.some((item) => item.name === name)) addImportError(errors, line, 'Duplicate faculty name already exists', maxErrors);
      if (seenNames.has(name)) addImportError(errors, line, 'Duplicate faculty name in import', maxErrors);
    }
    if (type === 'programs') {
      const facultyId = Number(row.facultyId ?? row.faculty_id);
      const name = String(row.name || '').trim().toLowerCase();
      if (!facultyId) addImportError(errors, line, 'Missing facultyId', maxErrors);
      else if (!facultyIds.has(facultyId)) addImportError(errors, line, 'Unknown facultyId', maxErrors);
      if (!name) addImportError(errors, line, 'Missing program name', maxErrors);
      if (programs.rows.some((item) => Number(item.faculty_id) === facultyId && item.name === name)) addImportError(errors, line, 'Duplicate program already exists for faculty', maxErrors);
      if (seenNames.has(`${facultyId}:${name}`)) addImportError(errors, line, 'Duplicate program in import', maxErrors);
      if (![4, 5, '4', '5'].includes(row.durationYears ?? row.duration_years)) addImportError(errors, line, 'Invalid duration', maxErrors);
    }
    if (type === 'programCourses') {
      const programId = Number(row.programId ?? row.program_id);
      const code = String(row.code || '').trim().toLowerCase();
      const name = String(row.name || '').trim().toLowerCase();
      const yearNo = Number(row.yearNo ?? row.year_no);
      const semesterNo = Number(row.semesterNo ?? row.semester_no);
      const credits = Number(row.credits ?? 0);
      if (!programId) addImportError(errors, line, 'Missing programId', maxErrors);
      else if (!programIds.has(programId)) addImportError(errors, line, 'Unknown programId', maxErrors);
      if (!code) addImportError(errors, line, 'Missing code', maxErrors);
      if (!name) addImportError(errors, line, 'Missing name', maxErrors);
      if (!Number.isInteger(yearNo) || yearNo < 1 || yearNo > 5) addImportError(errors, line, 'Invalid yearNo', maxErrors);
      if (!Number.isInteger(semesterNo) || semesterNo < 1 || semesterNo > 10) addImportError(errors, line, 'Invalid semesterNo', maxErrors);
      if (!Number.isInteger(credits) || credits < 0 || credits > 30) addImportError(errors, line, 'Invalid credits', maxErrors);
      if (programCourses.rows.some((item) => item.code === code || item.name === name)) addImportError(errors, line, 'Duplicate course code or name already exists', maxErrors);
      if (seenCodes.has(code)) addImportError(errors, line, 'Duplicate code in import', maxErrors);
      seenCodes.add(code);
      for (const prerequisiteCode of String(row.prerequisites || '').split(',').map((codeItem) => codeItem.trim().toLowerCase()).filter(Boolean)) {
        if (!courseCodeToId.has(prerequisiteCode)) addImportError(errors, line, `Unknown prerequisite code: ${prerequisiteCode}`, maxErrors);
      }
    }
    if (type === 'relationships') {
      const courseId = Number(row.courseId ?? row.course_id) || courseCodeToId.get(String(row.courseCode ?? row.course_code ?? '').trim().toLowerCase());
      const prerequisiteCourseId = Number(row.prerequisiteCourseId ?? row.prerequisite_course_id) || courseCodeToId.get(String(row.prerequisiteCode ?? row.prerequisite_code ?? '').trim().toLowerCase());
      if (!courseId || !courseIds.has(courseId)) addImportError(errors, line, 'Unknown course', maxErrors);
      if (!prerequisiteCourseId || !courseIds.has(prerequisiteCourseId)) addImportError(errors, line, 'Unknown prerequisite course', maxErrors);
      if (courseId && prerequisiteCourseId && courseId === prerequisiteCourseId) addImportError(errors, line, 'Course cannot require itself', maxErrors);
    }
    const nameKey = type === 'programs' ? `${Number(row.facultyId ?? row.faculty_id)}:${String(row.name || '').toLowerCase()}` : String(row.name || '').toLowerCase();
    if (nameKey && seenNames.has(nameKey)) addImportError(errors, line, 'Duplicate name in import', maxErrors);
    if (nameKey) seenNames.add(nameKey);
  }
  if (errors.truncated) errors.push({ line: 0, error: `Validation stopped after ${maxErrors} errors; reduce the import size or correct earlier rows.` });
  return {
    validation: { valid: errors.length === 0, count: list.length, errors, rows: list },
    referencesHash
  };
}

async function inspectImport(payload, executor = { query }, maxErrors = Infinity) {
  const { type, format = 'json', content, fileContent } = payload;
  if (!['faculties', 'programs', 'programCourses', 'relationships'].includes(type)) {
    return { validation: validationFailure('Unsupported import type'), referencesHash: '' };
  }
  if (!['json', 'csv', 'xlsx', 'pdf'].includes(format)) {
    return { validation: validationFailure('Unsupported import format'), referencesHash: '' };
  }
  let parsed;
  try { parsed = await importRows({ type, format, content, fileContent }); }
  catch (error) {
    return {
      validation: validationFailure(error.message || 'Invalid import file'),
      referencesHash: crypto.createHash('sha256').update('no-reference-lookup').digest('hex')
    };
  }
  const list = Array.isArray(parsed) ? parsed : parsed?.[type] || [];
  return validateImportRows(type, list, executor, maxErrors);
}

function stageValidation(validation) {
  return { valid: validation.valid, count: validation.count, errors: validation.errors };
}

function previewFingerprint(rows, validation, referencesHash) {
  return importPreviewFingerprint(rows, stageValidation(validation), referencesHash);
}

function publicImportStage(row, includeRows = true) {
  const validation = row.validation || {};
  const expired = row.status === 'staged' && new Date(row.expires_at).getTime() <= Date.now();
  return {
    id: row.id,
    type: row.import_type,
    format: row.import_format,
    status: expired ? 'expired' : row.status,
    previewVersion: row.preview_version,
    count: Number(validation.count || 0),
    valid: Boolean(validation.valid),
    errors: validation.errors || [],
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    publishedAt: row.published_at,
    cancelledAt: row.cancelled_at,
    ...(includeRows ? { rows: row.parsed_rows || [] } : {})
  };
}

function importStageFingerprint(stage, validation, referencesHash) {
  return previewFingerprint(stage.parsed_rows || [], validation, referencesHash);
}

function stageErrorDiff(before = [], after = []) {
  const key = (item) => `${item.line}:${item.error}`;
  const beforeKeys = new Set(before.map(key));
  const afterKeys = new Set(after.map(key));
  return {
    addedErrors: after.filter((item) => !beforeKeys.has(key(item))),
    resolvedErrors: before.filter((item) => !afterKeys.has(key(item)))
  };
}

function assertOwnedStage(result) {
  if (!result.rowCount) throw new NotFoundError('Import stage not found');
  return result.rows[0];
}

export async function validateImport(payload) {
  return (await inspectImport(payload)).validation;
}

export async function listImportStages(ownerId) {
  const { rows } = await listCatalogImportStagesForOwner({ query }, ownerId);
  return rows.map((row) => publicImportStage(row, false));
}

export async function getImportStage(id, ownerId) {
  return publicImportStage(assertOwnedStage(await findCatalogImportStageForOwner({ query }, id, ownerId)));
}

export async function createImportStage(payload, user) {
  if (!payload || !['faculties', 'programs', 'programCourses', 'relationships'].includes(payload.type)) {
    throw new AppError('Unsupported import type.', 400, 'UNSUPPORTED_IMPORT_TYPE');
  }
  if (!['json', 'csv', 'xlsx', 'pdf'].includes(payload.format || 'json')) {
    throw new AppError('Unsupported import format.', 400, 'UNSUPPORTED_IMPORT_FORMAT');
  }
  const { validation, referencesHash } = await inspectImport(payload, { query }, IMPORT_LIMITS.maxValidationErrors);
  const serializedRows = JSON.stringify(validation.rows || []);
  if (Buffer.byteLength(serializedRows, 'utf8') > IMPORT_LIMITS.maxStoredBytes) {
    throw new AppError('Parsed import exceeds the 8 MB staging storage limit.', 413, 'IMPORT_TOO_LARGE');
  }
  const preview = stageValidation(validation);
  const fingerprint = previewFingerprint(validation.rows || [], validation, referencesHash);
  return withPostgresClient(async (client) => {
    await client.query('BEGIN');
    try {
      await lockCatalogImportStageOwner(client, user.id);
      await deleteExpiredCatalogImportStages(client, user.id);
      const active = await countActiveCatalogImportStages(client, user.id);
      if (Number(active.rows[0]?.count || 0) >= IMPORT_LIMITS.maxActiveStagesPerAdmin) {
        throw new AppError(`You may have at most ${IMPORT_LIMITS.maxActiveStagesPerAdmin} active import stages.`, 429, 'IMPORT_STAGE_LIMIT');
      }
      const inserted = await insertCatalogImportStage(client, {
        ownerId: user.id,
        type: payload.type,
        format: payload.format || 'json',
        rows: validation.rows || [],
        validation: preview,
        referenceFingerprint: referencesHash,
        previewFingerprint: fingerprint
      });
      const stage = inserted.rows[0];
      await logAdminAction(client, {
        adminUser: user.name || user.email || 'Admin',
        action: 'Catalog Import Staged',
        entity: 'catalog_import_stage',
        newValues: { stageId: stage.id, type: stage.import_type, count: preview.count, expiresAt: stage.expires_at },
        description: `Staged ${preview.count} ${stage.import_type} import row(s)`
      });
      await client.query('COMMIT');
      return publicImportStage(stage);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    }
  });
}

export async function cancelImportStage(id, ownerId, adminName = 'Admin') {
  return withPostgresClient(async (client) => {
    await client.query('BEGIN');
    try {
      const stage = assertOwnedStage(await findCatalogImportStageForOwner(client, id, ownerId, { forUpdate: true }));
      if (stage.status !== 'staged') throw new ConflictError('Only active import stages can be cancelled.');
      const cancelled = await cancelCatalogImportStage(client, id, ownerId);
      if (!cancelled.rowCount) throw new ConflictError('Import stage is no longer available for cancellation.');
      await logAdminAction(client, {
        adminUser: adminName,
        action: 'Catalog Import Cancelled',
        entity: 'catalog_import_stage',
        newValues: { stageId: id, type: stage.import_type },
        description: `Cancelled staged ${stage.import_type} import`
      });
      await client.query('COMMIT');
      return publicImportStage(cancelled.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    }
  });
}

export async function publishImportStage(id, ownerId, expectedPreviewVersion, user) {
  return withPostgresClient(async (client) => {
    await client.query('BEGIN');
    try {
      const stage = assertOwnedStage(await findCatalogImportStageForOwner(client, id, ownerId, { forUpdate: true }));
      if (new Date(stage.expires_at).getTime() <= Date.now()) throw new AppError('Import stage has expired.', 410, 'IMPORT_STAGE_EXPIRED');
      if (stage.status === 'cancelled') throw new AppError('Cancelled import stages cannot be published.', 409, 'IMPORT_STAGE_CLOSED');
      if (stage.status === 'published') throw new AppError('Import stage has already been published.', 409, 'IMPORT_STAGE_CLOSED');
      if (stage.status !== 'staged') throw new ConflictError('Import stage is not available for publication.');
      if (!Number.isInteger(expectedPreviewVersion) || expectedPreviewVersion < 1) {
        throw new AppError('A valid preview version is required.', 400, 'INVALID_IMPORT_PREVIEW_VERSION');
      }
      const { validation, referencesHash } = await validateImportRows(
        stage.import_type, stage.parsed_rows || [], client, IMPORT_LIMITS.maxValidationErrors
      );
      const currentFingerprint = importStageFingerprint(stage, validation, referencesHash);
      if (currentFingerprint !== stage.preview_fingerprint) {
        const refreshed = await refreshCatalogImportStagePreview(client, {
          id,
          ownerId,
          validation: stageValidation(validation),
          referenceFingerprint: referencesHash,
          previewFingerprint: currentFingerprint
        });
        if (!refreshed.rowCount) {
          if (new Date(stage.expires_at).getTime() <= Date.now()) throw new AppError('Import stage has expired.', 410, 'IMPORT_STAGE_EXPIRED');
          throw new ConflictError('Import stage is no longer available.');
        }
        await client.query('COMMIT');
        return {
          outcome: 'stale',
          error: 'The catalog changed since this preview. Review the updated preview and confirm publication again.',
          code: 'IMPORT_PREVIEW_STALE',
          diff: { ...stageErrorDiff(stage.validation?.errors, validation.errors), catalogReferencesChanged: referencesHash !== stage.reference_fingerprint },
          stage: publicImportStage(refreshed.rows[0])
        };
      }
      if (expectedPreviewVersion !== Number(stage.preview_version)) {
        await client.query('ROLLBACK');
        return { outcome: 'version_conflict', stage: publicImportStage(stage), code: 'IMPORT_PREVIEW_VERSION_CONFLICT' };
      }
      if (!validation.valid) {
        await client.query('ROLLBACK');
        return { outcome: 'invalid', stage: publicImportStage(stage), code: 'IMPORT_VALIDATION_FAILED' };
      }

      let inserted = 0;
      for (const row of validation.rows) {
        await insertImportedRow(client, stage.import_type, row);
        inserted += 1;
      }
      await logAdminAction(client, {
        adminUser: user.name || user.email || 'Admin',
        action: `Imported ${stage.import_type}`,
        entity: stage.import_type,
        newValues: { inserted, stageId: id },
        description: `Imported ${inserted} ${stage.import_type} from staged import`
      });
      const published = await markCatalogImportStagePublished(client, id, ownerId);
      if (!published.rowCount) {
        if (new Date(stage.expires_at).getTime() <= Date.now()) throw new AppError('Import stage has expired.', 410, 'IMPORT_STAGE_EXPIRED');
        throw new ConflictError('Import stage is no longer available for publication.');
      }
      await client.query('COMMIT');
      return { outcome: 'published', stage: publicImportStage(published.rows[0], false), inserted, valid: true, errors: [] };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    }
  });
}
