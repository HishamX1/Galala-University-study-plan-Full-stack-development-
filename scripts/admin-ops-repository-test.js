import assert from 'node:assert/strict';
import {
  countActiveCatalogEntities, countDeletedCatalogEntities
} from '../backend/src/repositories/adminCatalogRepository.js';
import {
  countTodayAuditEvents, findLatestAuditEvent, listRecentAuditEvents
} from '../backend/src/repositories/auditRepository.js';
import { findLatestBackupCreatedAt } from '../backend/src/repositories/backupRepository.js';
import { findDeletedEntity } from '../backend/src/repositories/recycleBinRepository.js';

const calls = [];
const executor = {
  async query(sql, params = []) {
    calls.push({ sql, params });
    if (sql.includes('AS faculties')) return { rows: [{ faculties: 2, programs: 3, courses: 4, program_courses: 5, relationships: 6 }] };
    if (sql.includes("'Faculty' AS entity")) return { rows: [{ entity: 'Faculty', count: 1 }] };
    if (sql.includes('date_trunc')) return { rows: [{ count: 9 }] };
    if (sql.includes('ILIKE $1')) return { rows: [{ created_at: 'latest' }] };
    return { rows: [{ id: 8, created_at: 'recent' }] };
  }
};

assert.deepEqual((await countActiveCatalogEntities(executor)).rows[0],
  { faculties: 2, programs: 3, courses: 4, program_courses: 5, relationships: 6 });
assert.equal((await countDeletedCatalogEntities(executor)).rows[0].count, 1);
assert.equal((await countTodayAuditEvents(executor)).rows[0].count, 9);
assert.equal((await listRecentAuditEvents(executor)).rows[0].id, 8);
assert.equal((await findLatestAuditEvent(executor, 'Imported')).rows[0].created_at, 'latest');
assert.deepEqual(calls.at(-1).params, ['Imported%']);
assert.equal((await findLatestBackupCreatedAt(executor)).rows[0].id, 8);
assert.equal((await findDeletedEntity(executor, 'faculty', 42)).rows[0].id, 8);
assert.match(calls.at(-1).sql, /deleted_at IS NOT NULL/);
assert.deepEqual(calls.at(-1).params, [42]);
assert.equal(calls.length, 7);

console.log('Admin operations repository tests passed.');
