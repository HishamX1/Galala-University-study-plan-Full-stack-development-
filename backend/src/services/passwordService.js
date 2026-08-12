import bcrypt from 'bcryptjs';

export const BCRYPT_COST = 12;
const MIN_PASSWORD_LENGTH = 12;

export function validatePassword(password) {
  if (typeof password !== 'string') return 'Password is required.';
  if (!password || password.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.includes('\r') || password.includes('\n')) return 'Password must not contain newline characters.';
  if (password !== password.trim()) return 'Password must not begin or end with whitespace.';
  const characterClasses = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9\s]/].filter((pattern) => pattern.test(password)).length;
  if (characterClasses < 3) return 'Password must contain characters from at least three of: lowercase, uppercase, numbers, and symbols.';
  return null;
}

export async function hashPassword(password) {
  const error = validatePassword(password);
  if (error) throw new Error(error);
  return bcrypt.hash(password, BCRYPT_COST);
}

export async function verifyPassword(password, hash) {
  return typeof password === 'string' && typeof hash === 'string' && bcrypt.compare(password, hash);
}

export async function hashAndVerifyPassword(password) {
  const hash = await hashPassword(password);
  if (!(await verifyPassword(password, hash))) throw new Error('Password hash self-verification failed. No account was created.');
  return hash;
}
