import assert from 'node:assert/strict';
import fs from 'node:fs';
import { IDLE_SESSION_TIMEOUT_MS, startInactivityTimeout, stopInactivityTimeout } from '../frontend/shared/session.js';

class EventTargetStub {
  listeners = new Map();
  addEventListener(type, listener) { const listeners = this.listeners.get(type) || new Set(); listeners.add(listener); this.listeners.set(type, listeners); }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  dispatch(type) { for (const listener of this.listeners.get(type) || []) listener({ type }); }
}

class StorageStub {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { const oldValue = this.getItem(key); this.values.set(key, String(value)); if (globalThis.window) globalThis.window.dispatch('storage', { key, oldValue, newValue: String(value) }); }
  removeItem(key) { this.values.delete(key); }
}

const windowStub = new EventTargetStub();
const documentStub = new EventTargetStub();
const locationStub = { href: 'https://study.example.test/student/index.html', protocol: 'https:', hostname: 'study.example.test', port: '', search: '', replace(value) { this.href = value; } };
windowStub.location = locationStub;
windowStub.__GU_API_BASE__ = 'https://api.example.test/api';
documentStub.getElementById = () => null;
documentStub.querySelectorAll = () => [];
documentStub.querySelector = () => null;
globalThis.window = windowStub;
globalThis.document = documentStub;
globalThis.location = locationStub;
globalThis.localStorage = new StorageStub();
globalThis.sessionStorage = new StorageStub();
let logoutRequests = 0;
globalThis.fetch = async url => { if (String(url).endsWith('/auth/logout')) logoutRequests += 1; return { ok: true, status: 204 }; };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

assert.equal(IDLE_SESSION_TIMEOUT_MS, 300_000, 'idle timeout is exactly five minutes');
const student = { id: 'student-1', role: 'student', status: 'active' };
startInactivityTimeout(student, '../index.html', 45);
await wait(25);
windowStub.dispatch('keydown');
await wait(28);
assert.equal(logoutRequests, 0, 'a real key interaction resets the inactivity timer');
await wait(35);
assert.equal(logoutRequests, 1, 'idle student session calls the existing server logout endpoint');
assert.equal(new URL(locationStub.href).searchParams.get('sessionTimeout'), 'student');
assert.equal(new URL(locationStub.href).pathname, '/index.html', 'timed-out students return to the home page');

locationStub.href = 'https://study.example.test/admin/index.html';
startInactivityTimeout({ id: 'admin-1', role: 'super_admin', status: 'active' }, '../index.html', 30);
await wait(55);
assert.equal(logoutRequests, 2, 'idle administrator session uses the same logout endpoint');
assert.equal(new URL(locationStub.href).searchParams.get('sessionTimeout'), 'super_admin');
assert.equal(new URL(locationStub.href).pathname, '/index.html', 'timed-out administrators return to the home page');
stopInactivityTimeout();

const adminAuth = fs.readFileSync(new URL('../frontend/admin/modules/auth.js', import.meta.url), 'utf8');
assert.equal((adminAuth.match(/startInactivityTimeout\(user, '\.\.\/index\.html'\)/g) || []).length, 2,
  'both a new admin login and a restored admin session start the inactivity timer');
assert.match(adminAuth, /sessionExpiredRole: window\.__GU_ADMIN_ROLE__ \|\| 'regular_admin'/,
  'an expired admin session returns to home with an admin-specific status message');

console.log('Five-minute shared student and administrator idle-session tests passed.');
