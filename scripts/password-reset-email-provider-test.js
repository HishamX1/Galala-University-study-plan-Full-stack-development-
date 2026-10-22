import assert from 'node:assert/strict';
import { createPasswordResetEmailSender, EmailConfigurationError, getPasswordResetEmailConfig } from '../backend/src/services/passwordResetEmailService.js';

const configuration = {
  resendApiKey: 're_test_not_a_real_credential',
  resendFromEmail: 'support@example.test',
  publicAppUrl: 'https://study.example.test',
  nodeEnv: 'production'
};

assert.throws(() => getPasswordResetEmailConfig({ ...configuration, resendApiKey: '' }), EmailConfigurationError);
assert.throws(() => getPasswordResetEmailConfig({ ...configuration, publicAppUrl: 'https://study.example.test/path' }), EmailConfigurationError);
assert.throws(() => getPasswordResetEmailConfig({ ...configuration, publicAppUrl: 'http://study.example.test' }), EmailConfigurationError);

let sentRequest;
const sender = createPasswordResetEmailSender({
  configuration,
  fetchImpl: async (url, options) => {
    sentRequest = { url, options };
    return { ok: true, status: 200 };
  }
});
await sender({ recipient: 'student@example.test', resetUrl: 'https://study.example.test/reset-password.html?token=abc&audience=student' });
assert.equal(sentRequest.url, 'https://api.resend.com/emails');
assert.equal(sentRequest.options.method, 'POST');
assert.equal(sentRequest.options.headers.Authorization, `Bearer ${configuration.resendApiKey}`);
const payload = JSON.parse(sentRequest.options.body);
assert.deepEqual(payload.to, ['student@example.test']);
assert.equal(payload.from, configuration.resendFromEmail);
assert.match(payload.text, /expires in one hour/i);
assert.match(payload.html, /audience=student/);

await assert.rejects(
  createPasswordResetEmailSender({ configuration, fetchImpl: async () => ({ ok: false, status: 500, text: async () => 'provider-private-detail' }) })({ recipient: 'student@example.test', resetUrl: 'https://study.example.test/reset-password.html?token=x' }),
  (error) => error.message === 'EMAIL_DELIVERY_FAILED' && !error.message.includes('provider-private-detail')
);
await assert.rejects(
  sender({ recipient: 'student@example.test', resetUrl: 'https://attacker.example/reset-password.html?token=x' }),
  (error) => error.message === 'EMAIL_DELIVERY_FAILED'
);

console.log('Password-reset email provider contract tests passed (network call mocked).');
