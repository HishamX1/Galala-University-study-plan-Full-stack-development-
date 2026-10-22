# Student password reset by email

The student login's **Forgot password?** flow accepts a registered email address and sends a one-time password-reset link only when it matches an active `student` account. The response body and status are the same for unknown addresses, non-student accounts, inactive students, and requests suppressed by the account limit. This is not constant-time: synchronous email-provider latency can still create a timing side channel, so the generic response reduces but does not eliminate account enumeration. The existing administrator-reviewed `/api/auth/password-reset-requests` path remains separate and unchanged for administrator accounts; it does not send email.

## Request and token safeguards

- Reset tokens are generated with cryptographic randomness. Only a SHA-256 hash is stored in PostgreSQL; links expire after one hour and are single-use.
- Each issuance and invalidation is committed together. Email is sent only after that transaction commits. If the provider rejects or times out, the new token is invalidated and the endpoint retains its generic response; the student can request a fresh link.
- A student account can receive at most three email-reset tokens per hour. The API also applies an in-process per-IP throttle of five requests per 15 minutes, in addition to the existing authentication-sensitive limit. Per-IP state is local to each backend process and is not a distributed limit; the account limit is database-backed.
- Password reset uses the existing transaction to update the password, consume the token, and revoke all refresh sessions. The reset page suppresses referrer transmission so the token query parameter is not sent as a referrer.
- Provider errors, API keys, and reset tokens are not returned in API responses or written to application logs. The email provider receives the raw link so it can deliver it.

## Provider configuration

The backend uses Resend's email-send API. Before enabling the feature, an owner must configure and verify the sending domain with Resend, then add these backend-only environment variables in Render:

| Variable | Purpose |
|---|---|
| `RESEND_API_KEY` | Secret API key with permission to send email. Never put it in Vercel or frontend files. |
| `RESEND_FROM_EMAIL` | Sender address on the verified sending domain. |
| `PUBLIC_APP_URL` | Frontend origin used to construct reset links, for example `https://galala-university-study-plan-center.vercel.app`. |

These values are validated when a student requests a reset, not at backend startup. Missing or invalid configuration returns a generic temporary-unavailability response and does not query account data. No provider credentials or production settings are configured by this code change.

## Database and verification

Apply the ordered migration `supabase/migrations/20261022120000_student_password_reset_email.sql` through the project's approved migration process before enabling this endpoint. It labels token delivery sources and adds the account-rate-limit index. Do not apply it to a hosted database as part of this feature review.

The provider contract test uses a mocked HTTP call. The PostgreSQL integration test must run only against the guarded disposable database named `gu_pt_phase1_test`; it creates uniquely named test users and a temporary test-only trigger to verify transactional rollback, then removes those fixtures. The GitHub Actions integration workflow provisions that database, applies ordered migrations, and runs the tests. Local PostgreSQL evidence is separate from production provider delivery evidence.

Before production use, verify the Resend sender/domain, Render variables, frontend origin, and a controlled reset using an approved student test account. A successful provider API response confirms acceptance by the provider, not inbox delivery. Keep the current administrator-approved reset workflow available as a fallback.
