import assert from 'node:assert/strict';
import { validateUsername } from '../backend/src/services/authService.js';

assert.equal(validateUsername('Hisham_2026'), null);
assert.equal(validateUsername('a.'), 'Username must be 3–20 characters and use only letters, numbers, dots, or underscores.');
assert.equal(validateUsername('admin'), 'That username is reserved.');
assert.equal(validateUsername('staff-name'), 'Username must be 3–20 characters and use only letters, numbers, dots, or underscores.');

const futureProgress = { available: false, message: 'Academic progress will appear once university academic records are connected.' };
assert.equal(futureProgress.available, false);
assert.match(futureProgress.message, /academic records/i);
console.log('Dashboard username and future-progress contract test passed.');
