import assert from 'node:assert/strict';
import { rotateRefreshSession } from '../backend/src/services/authService.js';
import { tokenHash } from '../backend/src/repositories/sessionRepository.js';

const presentedToken = 'refresh-token-under-test';
const hash = tokenHash(presentedToken);
const user = { id: 'user-1', role: 'student', status: 'active', name: 'Rollback Test', email: 'rollback@example.test' };
const state = { active: true, replacements: 0, auditEvents: [], committed: false, rolledBack: false, snapshot: null };
const client = {
  async query(sql, params = []) {
    if (sql === 'BEGIN') {
      state.snapshot = { active: state.active, replacements: state.replacements, auditEvents: [...state.auditEvents] };
      return { rows: [] };
    }
    if (sql === 'COMMIT') { state.committed = true; return { rows: [] }; }
    if (sql === 'ROLLBACK') {
      Object.assign(state, state.snapshot, { rolledBack: true });
      return { rows: [] };
    }
    if (sql.includes('SELECT u.*') && params[0] === hash) return { rows: state.active ? [user] : [] };
    if (sql.startsWith('UPDATE public.auth_refresh_tokens')) { state.active = false; return { rows: [] }; }
    if (sql.startsWith('INSERT INTO public.auth_refresh_tokens')) throw new Error('forced replacement insert failure');
    throw new Error(`Unexpected query: ${sql}`);
  }
};

await client.query('BEGIN');
await assert.rejects(() => rotateRefreshSession(hash, client), /forced replacement insert failure/);
await client.query('ROLLBACK');

assert.equal(state.rolledBack, true);
assert.equal(state.committed, false);
assert.equal(state.active, true, 'original refresh session must remain active after rollback');
assert.equal(state.replacements, 0, 'replacement session must not remain after rollback');
assert.deepEqual(state.auditEvents, [], 'rollback must not leave partial audit/security state');

console.log('Refresh-token transaction rollback regression test passed.');
