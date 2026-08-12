import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { bootstrapSuperAdmin, countUsers } from '../backend/src/services/authService.js';
import { getDatabaseReadiness } from '../backend/src/db/client.js';
import { validatePassword } from '../backend/src/services/passwordService.js';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const prompt = createInterface({ input, output });

async function promptHidden(label) {
  if (!input.isTTY || typeof input.setRawMode !== 'function') throw new Error('A supported interactive terminal is required to enter a password securely.');
  output.write(label);
  input.setRawMode(true);
  input.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const done = (error) => {
      input.off('data', onData);
      input.setRawMode(false);
      output.write('\n');
      error ? reject(error) : resolve(value);
    };
    const onData = (chunk) => {
      for (const character of String(chunk)) {
        if (character === '\u0003') return done(new Error('Password entry cancelled.'));
        if (character === '\r' || character === '\n') return done();
        if (character === '\u007f' || character === '\b') { value = value.slice(0, -1); continue; }
        value += character;
      }
    };
    input.on('data', onData);
  });
}

try {
  const readiness = await getDatabaseReadiness();
  if (!readiness.connected) throw new Error(readiness.error);
  if (!readiness.app_users || !readiness.refresh_tokens) throw new Error('Authentication migration has not been applied. Run the database migrations before bootstrapping.');
  if (await countUsers()) {
    console.log('Bootstrap skipped. Users already exist.');
  } else {
    const name = (await prompt.question('Name: ')).trim();
    const email = (await prompt.question('Email: ')).trim();
    const password = await promptHidden('Password: ');
    const confirmation = await promptHidden('Confirm password: ');
    if (!name) throw new Error('Name is required.');
    if (!emailPattern.test(email)) throw new Error('A valid email is required.');
    const passwordError = validatePassword(password);
    if (passwordError) throw new Error(passwordError);
    if (password !== confirmation) throw new Error('Password confirmation does not match.');
    const user = await bootstrapSuperAdmin({ name, email, password });
    console.log(user ? `Super Admin created for ${user.email}.` : 'Bootstrap skipped. Users already exist.');
  }
} catch (error) {
  console.error(`Bootstrap failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  prompt.close();
}
