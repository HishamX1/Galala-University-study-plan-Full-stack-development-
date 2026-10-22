import assert from 'node:assert/strict';
import fs from 'node:fs';

const doctor = fs.readFileSync('scripts/doctor.js', 'utf8');
const deploymentGuide = fs.readFileSync('docs/deployment.md', 'utf8');

assert.match(doctor, /getPasswordResetEmailConfig\(\)/,
  'the deployment doctor should catch missing or invalid student recovery email configuration');
assert.match(doctor, /required backend settings are missing or invalid/,
  'the doctor should report email configuration failure without printing secret values');
assert.match(doctor, /Provider dashboard settings are not inspected here/,
  'the doctor must distinguish local repository checks from provider-dashboard verification');
assert.doesNotMatch(doctor, /read\(path\.join\(repositoryRoot,\s*['"]netlify\.toml/i,
  'the doctor must not read the retained Netlify manifest as active hosting configuration');
assert.doesNotMatch(doctor, /check\([^\n]*(?:Netlify publish directory|Netlify security headers)/i,
  'the doctor must not treat retained Netlify settings as active production hosting');
assert.doesNotMatch(doctor, /resendApiKey\s*\}|resendFromEmail\s*\}|publicAppUrl\s*\}/,
  'the doctor must not print password-reset provider secrets or configured URLs');
assert.match(deploymentGuide, /active frontend host is Vercel/i);
assert.match(deploymentGuide, /netlify\.toml.*legacy configuration/i);
assert.match(deploymentGuide, /RESEND_API_KEY[\s\S]*RESEND_FROM_EMAIL[\s\S]*PUBLIC_APP_URL/,
  'the release guide should list the backend-only reset-mail configuration requirements');
assert.doesNotMatch(deploymentGuide, /CORS_ORIGIN=<Netlify site origin>/i,
  'the release guide must not direct operators to configure Netlify as the live frontend');

console.log('Deployment doctor provider-boundary and release-documentation contract tests passed.');
