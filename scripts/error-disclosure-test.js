import assert from 'node:assert/strict';
import { ValidationError, isSafeClientError, toErrorResponse } from '../backend/src/utils/errors.js';

assert.deepEqual(toErrorResponse(new ValidationError('Invalid faculty name')), {
  status: 400,
  body: { error: 'Invalid faculty name', code: 'VALIDATION_ERROR' }
});
assert.equal(isSafeClientError(new Error('Password must be at least 12 characters.')), true);
assert.equal(isSafeClientError(new Error('password authentication failed for user app_user')), false);

const internal = toErrorResponse(new Error('error: relation public.app_users does not exist at /srv/app/backend/src/db/client.js\n    at query (node_modules/pg/index.js:1:1)'), 'request-123');
assert.equal(internal.status, 500);
assert.deepEqual(internal.body, {
  error: 'An unexpected error occurred.',
  code: 'INTERNAL_ERROR',
  requestId: 'request-123'
});
assert.doesNotMatch(JSON.stringify(internal.body), /relation|public\.app_users|node_modules|backend|stack|at query/i);

console.log('Error-disclosure regression test passed.');
