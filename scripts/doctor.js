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
function readJson(file) { try { return JSON.parse(read(file)); } catch { return null; } }

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
const vercel = readJson(path.join(repositoryRoot, 'vercel.json'));
check(vercel?.outputDirectory === 'frontend', 'Vercel static output directory', vercel?.outputDirectory || 'vercel.json is missing or invalid');
const rewrites = Array.isArray(vercel?.rewrites) ? vercel.rewrites : [];
const requiredRoutes = [
  ['/', '/index.html'],
  ['/student', '/student/index.html'],
  ['/admin', '/admin/index.html']
];
check(requiredRoutes.every(([source, destination]) => rewrites.some((route) => route.source === source && route.destination === destination)), 'Vercel static page routes');
const vercelHeaders = Array.isArray(vercel?.headers) ? vercel.headers.flatMap((rule) => rule.headers || []) : [];
const headerValues = new Map(vercelHeaders.map(({ key, value }) => [String(key).toLowerCase(), value]));
const requiredHeaders = ['x-content-type-options', 'x-frame-options', 'referrer-policy', 'permissions-policy', 'content-security-policy', 'strict-transport-security'];
check(requiredHeaders.every((name) => headerValues.has(name)), 'Vercel security response headers');
const csp = String(headerValues.get('content-security-policy') || '');
check(csp.includes("https://fonts.googleapis.com") && csp.includes("https://fonts.gstatic.com")
  && csp.includes('https://galala-university-study-plan-full-stack-kd69.onrender.com'), 'Vercel CSP permits configured font and Render API origins');
check(!vercel?.rewrites?.some((route) => String(route.destination || '').startsWith('/api')), 'Vercel does not proxy authenticated API requests');
check(fs.existsSync(path.join(repositoryRoot, 'frontend', 'student-login.html'))
  && fs.existsSync(path.join(repositoryRoot, 'frontend', 'images', 'GU-Logo-Color-Original.png')),
'Vercel direct HTML pages and static assets remain in the output directory');
console.log('ℹ Vercel dashboard project-root, environment, and override settings are not inspected. Configure the repository root as project root; vercel.json publishes frontend/.');

await closePool();
console.log(`\n${failed ? 'Doctor found issues. Resolve every ✗ before production deployment.' : 'Doctor passed. Deployment prerequisites look ready.'}`);
process.exitCode = failed ? 1 : 0;
