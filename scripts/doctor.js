import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env, validateStartupConfig } from '../backend/src/config/env.js';
import { closePool, getDatabaseReadiness } from '../backend/src/db/client.js';
import { countUsers } from '../backend/src/services/authService.js';
import { getPasswordResetEmailConfig } from '../backend/src/services/passwordResetEmailService.js';
import { getSchemaMigrationState } from './migration-preflight.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(__dirname, '..');
let failed = false;
function check(ok, label, detail = '') { console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`); if (!ok) failed = true; }
function read(file) { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } }

console.log('Galala Study Plan deployment doctor\n');
try { validateStartupConfig(); check(true, 'Backend configuration'); }
catch (error) { check(false, 'Backend configuration', error.message); }
check(Boolean(env.databaseUrl), 'DATABASE_URL configured');
check(Boolean(env.jwtSecret) && (env.nodeEnv !== 'production' || Boolean(process.env.JWT_SECRET)), 'JWT_SECRET configured');
check(Boolean(env.corsOrigins.length) && (env.nodeEnv !== 'production' || !env.corsOrigins.includes('*')), 'CORS_ORIGIN configured');
check(env.nodeEnv !== 'production' || env.cookieSecure, 'COOKIE_SECURE enabled for production');
check(['Lax', 'Strict', 'None'].includes(env.cookieSameSite) && (env.cookieSameSite !== 'None' || env.cookieSecure), 'COOKIE_SAME_SITE compatible with secure cookies');
try {
  getPasswordResetEmailConfig();
  check(true, 'Student password-reset email configuration');
} catch {
  check(false, 'Student password-reset email configuration', 'required backend settings are missing or invalid');
}

const database = await getDatabaseReadiness();
check(database.connected, 'Database connection', database.connected ? 'connected' : database.error);
if (database.connected) {
  check(Boolean(database.faculties), 'Canonical catalog migration applied');
  check(Boolean(database.app_users && database.refresh_tokens), 'Authentication migration applied');
  const migrationState = await getSchemaMigrationState();
  if (!migrationState.available) {
    check(false, 'Supabase migration history available', migrationState.reason);
  } else {
    check(migrationState.missing.length === 0 && migrationState.unexpected.length === 0, 'All repository migrations recorded as applied',
      migrationState.missing.length
        ? `missing ${migrationState.missing.join(', ')}`
        : migrationState.unexpected.length
          ? `unexpected ${migrationState.unexpected.join(', ')}`
          : `${migrationState.migrations.length} migrations verified`);
  }
  if (database.app_users && database.refresh_tokens) {
    const users = await countUsers();
    check(true, 'Bootstrap readiness', users ? `disabled safely (${users} user${users === 1 ? '' : 's'} exist)` : 'ready to create the first Super Admin');
  }
}

const frontendConfig = read(path.join(repositoryRoot, 'frontend', 'config.js'));
check(/window\.__GU_API_BASE__/.test(frontendConfig), 'Frontend API configuration present');
check(/guLocalApiHosts/.test(frontendConfig) && /http:\/\/localhost:4000\/api/.test(frontendConfig) && /http:\/\/127\.0\.0\.1:4000\/api/.test(frontendConfig), 'Frontend local API detection configured');
check(/https:\/\/galala-university-study-plan-full-stack-kd69\.onrender\.com\/api/.test(frontendConfig), 'Frontend production API configured');
check(fs.existsSync(path.join(repositoryRoot, 'frontend', 'index.html')), 'Static frontend entry point present');
const render = read(path.join(repositoryRoot, 'render.yaml'));
check(/NODE_ENV[\s\S]*production/.test(render) && /JWT_SECRET/.test(render), 'Render source manifest declares production runtime settings');
console.log('ℹ Provider dashboard settings are not inspected here. Confirm Vercel frontend and Render backend settings through their authorized dashboards; netlify.toml is retained legacy configuration.');

await closePool();
console.log(`\n${failed ? 'Doctor found issues. Resolve every ✗ before production deployment.' : 'Doctor passed. Deployment prerequisites look ready.'}`);
process.exitCode = failed ? 1 : 0;
