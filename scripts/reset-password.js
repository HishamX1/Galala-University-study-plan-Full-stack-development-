import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { findUserByIdentifier, resetUserPassword } from '../backend/src/services/authService.js';
import { getDatabaseReadiness } from '../backend/src/db/client.js';
import { validatePassword } from '../backend/src/services/passwordService.js';

const prompt = createInterface({ input, output });

async function promptHidden(label) {
  if (!input.isTTY || typeof input.setRawMode !== 'function') throw new Error('A supported interactive terminal is required to enter a password securely.');
  output.write(label);
  input.setRawMode(true);
  input.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const done = (error) => { input.off('data', onData); input.setRawMode(false); output.write('\n'); error ? reject(error) : resolve(value); };
    const onData = (chunk) => { for (const character of String(chunk)) { if (character === '\u0003') return done(new Error('Password entry cancelled.')); if (character === '\r' || character === '\n') return done(); if (character === '\u007f' || character === '\b') { value = value.slice(0, -1); continue; } value += character; } };
    input.on('data', onData);
  });
}

const superAdminOnly = process.argv.includes('--super-admin-only');
try {
  const readiness = await getDatabaseReadiness();
  if (!readiness.connected || !readiness.app_users) throw new Error(readiness.error || 'Authentication migration has not been applied.');
  const identifier = (await prompt.question('Email or Student ID: ')).trim();
  if (!identifier) throw new Error('Email or Student ID is required.');
  const user = await findUserByIdentifier(identifier);
  if (!user) throw new Error('User not found.');
  if (superAdminOnly && user.role !== 'super_admin') throw new Error('The selected user is not a Super Admin.');
  const password = await promptHidden('New password: ');
  const confirmation = await promptHidden('Confirm new password: ');
  const passwordError = validatePassword(password);
  if (passwordError) throw new Error(passwordError);
  if (password !== confirmation) throw new Error('Password confirmation does not match.');
  await resetUserPassword(user.id, password);
  console.log('Password reset and storage verification completed.');
} catch (error) {
  console.error(`Password reset failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  prompt.close();
}
