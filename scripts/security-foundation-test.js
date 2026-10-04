import assert from 'node:assert/strict';
import { Permissions, hasPermission } from '../backend/src/security/permissions.js';
import { allowRequest } from '../backend/src/security/rateLimiter.js';
import { assignRequestId } from '../backend/src/middleware/requestContext.js';
import { AuthenticationError, ConflictError, toErrorResponse } from '../backend/src/utils/errors.js';

assert.equal(hasPermission({ role: 'student' }, Permissions.catalogRead), true);
assert.equal(hasPermission({ role: 'student' }, Permissions.catalogWrite), false);
assert.equal(hasPermission({ role: 'regular_admin' }, Permissions.catalogImport), true);
assert.equal(hasPermission({ role: 'regular_admin' }, Permissions.usersDelete), false);
assert.equal(hasPermission({ role: 'super_admin' }, Permissions.usersDelete), true);

assert.equal(allowRequest('foundation-test', { limit: 2, windowMs: 60_000 }), true);
assert.equal(allowRequest('foundation-test', { limit: 2, windowMs: 60_000 }), true);
assert.equal(allowRequest('foundation-test', { limit: 2, windowMs: 60_000 }), false);

const headers = new Map();
const req = { headers: { 'x-request-id': 'safe-request-123' } };
assignRequestId(req, { setHeader: (name, value) => headers.set(name, value) });
assert.equal(req.requestId, 'safe-request-123');
assert.equal(headers.get('X-Request-ID'), 'safe-request-123');

assert.deepEqual(toErrorResponse(new AuthenticationError()), { status: 401, body: { error: 'Authentication required', code: 'AUTHENTICATION_ERROR' } });
assert.deepEqual(toErrorResponse(new ConflictError('Duplicate')), { status: 409, body: { error: 'Duplicate', code: 'CONFLICT' } });
assert.equal(toErrorResponse(new Error('secret database failure')).body.error, 'An unexpected error occurred.');

console.log('Security foundation unit test passed.');
