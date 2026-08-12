import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../../');

function unquote(value) {
  const trimmed = String(value || '').trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

const inheritedKeys = new Set([...Object.keys(process.env), 'NODE_ENV']);
function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (!inheritedKeys.has(key)) process.env[key] = unquote(rawValue);
  }
}

// Lowest to highest priority. Shell/host values always take precedence.
const envMode = process.env.NODE_ENV || 'development';
for (const name of ['.env', `.env.${envMode}`, '.env.local']) loadDotEnv(path.join(projectRoot, name));

function parseOrigins(value) {
  return String(value || '').split(',').map((origin) => origin.trim()).filter(Boolean);
}

const configuredCorsOrigins = parseOrigins(process.env.CORS_ORIGINS || process.env.CORS_ORIGIN);
const developmentCorsOrigins = [
  'http://localhost:4000',
  'http://127.0.0.1:4000',
  'http://localhost:5500',
  'http://127.0.0.1:5500'
];
const corsOrigins = envMode === 'production'
  ? configuredCorsOrigins
  : [...new Set([...developmentCorsOrigins, ...configuredCorsOrigins])];

export const env = {
  nodeEnv: envMode,
  port: Number(process.env.PORT || 4000),
  apiBasePath: process.env.API_BASE_PATH || '/api',
  // CORS_ORIGIN supports a single origin or a comma-separated list. CORS_ORIGINS
  // is an equivalent explicit plural form. Production receives no implicit origins.
  corsOrigins,
  allowCorsOrigin: corsOrigins[0] || '',
  databaseUrl: process.env.DATABASE_URL || '',
  jwtSecret: process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'development-only-change-me'),
  cookieSecure: process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production',
  cookieSameSite: process.env.COOKIE_SAME_SITE || (process.env.NODE_ENV === 'production' ? 'None' : 'Lax'),
  pgSsl: ['1', 'true', 'yes'].includes(String(process.env.PG_SSL || '').toLowerCase()) ||
    /sslmode=require/i.test(process.env.DATABASE_URL || '')
};

export function validateStartupConfig() {
  const issues = [];
  if (!env.databaseUrl) issues.push('DATABASE_URL is required.');
  if (env.nodeEnv === 'production' && !process.env.JWT_SECRET) issues.push('JWT_SECRET is required in production.');
  if (env.nodeEnv === 'production' && (!env.corsOrigins.length || env.corsOrigins.includes('*'))) issues.push('CORS_ORIGIN must be an explicit origin in production; wildcard (*) is not allowed.');
  if (!['Lax', 'Strict', 'None'].includes(env.cookieSameSite)) issues.push('COOKIE_SAME_SITE must be Lax, Strict, or None.');
  if (env.cookieSameSite === 'None' && !env.cookieSecure) issues.push('COOKIE_SECURE=true is required when COOKIE_SAME_SITE=None.');
  if (issues.length) throw new Error(`Startup configuration error: ${issues.join(' ')}`);
  if (!process.env.JWT_SECRET) console.warn('WARNING: JWT_SECRET is not configured; using the development-only fallback.');
  if (!process.env.CORS_ORIGIN && !process.env.CORS_ORIGINS) console.warn(`WARNING: CORS origin is not configured; using development origins: ${env.corsOrigins.join(', ')}.`);
}
