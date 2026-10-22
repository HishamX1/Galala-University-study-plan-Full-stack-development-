import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';

const RESEND_SEND_URL = 'https://api.resend.com/emails';
const EMAIL_PATTERN = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;

export class EmailConfigurationError extends AppError {
  constructor() {
    super('Password reset email is temporarily unavailable. Please contact Student Support.', 503, 'EMAIL_UNAVAILABLE');
  }
}

function validatedPublicAppUrl(value, nodeEnv) {
  let parsed;
  try { parsed = new URL(value); }
  catch { throw new EmailConfigurationError(); }
  const localDevelopmentUrl = nodeEnv !== 'production'
    && parsed.protocol === 'http:'
    && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if ((!localDevelopmentUrl && parsed.protocol !== 'https:')
    || parsed.username || parsed.password || parsed.search || parsed.hash
    || !['', '/'].includes(parsed.pathname)) {
    throw new EmailConfigurationError();
  }
  return parsed.origin;
}

export function getPasswordResetEmailConfig(configuration = env) {
  const apiKey = String(configuration.resendApiKey || '').trim();
  const fromEmail = String(configuration.resendFromEmail || '').trim();
  const publicAppUrl = String(configuration.publicAppUrl || '').trim();
  if (!apiKey || apiKey.length > 512 || !EMAIL_PATTERN.test(fromEmail) || !publicAppUrl) {
    throw new EmailConfigurationError();
  }
  return {
    apiKey,
    fromEmail,
    publicAppUrl: validatedPublicAppUrl(publicAppUrl, configuration.nodeEnv || env.nodeEnv)
  };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

export function createPasswordResetEmailSender({ configuration = env, fetchImpl = globalThis.fetch } = {}) {
  return async ({ recipient, resetUrl }) => {
    const config = getPasswordResetEmailConfig(configuration);
    if (typeof fetchImpl !== 'function') throw new Error('EMAIL_DELIVERY_FAILED');

    let link;
    try { link = new URL(resetUrl); }
    catch { throw new Error('EMAIL_DELIVERY_FAILED'); }
    if (link.origin !== config.publicAppUrl || link.protocol !== 'https:' && !link.hostname.match(/^(localhost|127\.0\.0\.1|\[::1\])$/)) {
      throw new Error('EMAIL_DELIVERY_FAILED');
    }
    const safeLink = escapeHtml(link.href);
    const response = await fetchImpl(RESEND_SEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: config.fromEmail,
        to: [recipient],
        subject: 'Reset your Galala University Study Plan password',
        text: `Use this one-time link to reset your password. It expires in one hour: ${link.href}`,
        html: `<p>We received a request to reset the password for your Galala University Study Plan account.</p><p><a href="${safeLink}">Reset your password</a></p><p>This one-time link expires in one hour. If you did not request it, you can ignore this email.</p>`
      }),
      signal: AbortSignal.timeout(8_000)
    });
    if (!response.ok) throw new Error('EMAIL_DELIVERY_FAILED');
    return true;
  };
}

export const sendPasswordResetEmail = createPasswordResetEmailSender();
