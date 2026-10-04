import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env, validateStartupConfig } from '../backend/src/config/env.js';
import { closePool, getDatabaseReadiness } from '../backend/src/db/client.js';
import { countUsers } from '../backend/src/services/authService.js';

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

const database = await getDatabaseReadiness();
check(database.connected, 'Database connection', database.connected ? 'connected' : database.error);
if (database.connected) {
  check(Boolean(database.faculties), 'Canonical catalog migration applied');
  check(Boolean(database.app_users && database.refresh_tokens), 'Authentication migration applied');
  check(Boolean(database.migration_history), 'Supabase migration history available', database.migration_history ? 'migration history table found' : 'table unavailable; table checks used instead');
  if (database.app_users && database.refresh_tokens) {
    const users = await countUsers();
    check(true, 'Bootstrap readiness', users ? `disabled safely (${users} user${users === 1 ? '' : 's'} exist)` : 'ready to create the first Super Admin');
  }
}

const frontendConfig = read(path.join(repositoryRoot, 'frontend', 'config.js'));
check(/window\.__GU_API_BASE__/.test(frontendConfig), 'Frontend API configuration present');
check(/guLocalApiHosts/.test(frontendConfig) && /http:\/\/localhost:4000\/api/.test(frontendConfig) && /http:\/\/127\.0\.0\.1:4000\/api/.test(frontendConfig), 'Frontend local API detection configured');
check(/https:\/\/galala-university-study-plan-full-stack-kd69\.onrender\.com\/api/.test(frontendConfig), 'Frontend production API configured');
const render = read(path.join(repositoryRoot, 'render.yaml'));
check(/NODE_ENV[\s\S]*production/.test(render) && /JWT_SECRET/.test(render), 'Render production environment declares NODE_ENV and JWT_SECRET');
const netlify = read(path.join(repositoryRoot, 'netlify.toml'));
check(/publish\s*=\s*"frontend"/.test(netlify), 'Netlify publish directory');
check(/X-Content-Type-Options/.test(netlify) && /X-Frame-Options/.test(netlify), 'Netlify security headers');

await closePool();
console.log(`\n${failed ? 'Doctor found issues. Resolve every ✗ before production deployment.' : 'Doctor passed. Deployment prerequisites look ready.'}`);
process.exitCode = failed ? 1 : 0;
