import assert from 'node:assert/strict';
import { validateExpectedVersion } from '../backend/src/validation/schemas.js';
import { AppError, toErrorResponse } from '../backend/src/utils/errors.js';

const facultyVersion = { updatedAt: '2026-10-21T10:20:30.123456Z' };
const courseVersion = { updatedAt: '2026-10-21T10:20:30.123456Z', relatedUpdatedAt: '2026-10-21T10:20:31.456789Z' };

assert.equal(validateExpectedVersion({ name: 'Faculty' }), null, 'legacy callers may omit a version');
assert.equal(validateExpectedVersion({ expectedVersion: facultyVersion }), null);
assert.equal(validateExpectedVersion({ expectedVersion: courseVersion }, ['updatedAt', 'relatedUpdatedAt']), null);
assert.equal(validateExpectedVersion({ expectedVersion: { updatedAt: 'not-a-date' } }), 'Invalid expectedVersion');
assert.equal(validateExpectedVersion({ expectedVersion: { updatedAt: '2026-10-21T10:20:30.123Z' } }), 'Invalid expectedVersion', 'versions must retain PostgreSQL microsecond precision');
assert.equal(validateExpectedVersion({ expectedVersion: { updatedAt: '2026-02-31T10:20:30.123456Z' } }), 'Invalid expectedVersion', 'calendar-invalid timestamps must fail before reaching SQL');
assert.equal(validateExpectedVersion({ expectedVersion: { updatedAt: facultyVersion.updatedAt, extra: true } }), 'Invalid expectedVersion');
assert.equal(validateExpectedVersion({ expectedVersion: facultyVersion }, ['updatedAt', 'relatedUpdatedAt']), 'Invalid expectedVersion');
assert.equal(validateExpectedVersion({ expectedVersion: courseVersion }), 'Invalid expectedVersion');
assert.deepEqual(toErrorResponse(new AppError('This record changed.', 409, 'STALE_WRITE')), {
  status: 409,
  body: { error: 'This record changed.', code: 'STALE_WRITE' }
});

console.log('Catalog optimistic-concurrency request contract tests passed.');
