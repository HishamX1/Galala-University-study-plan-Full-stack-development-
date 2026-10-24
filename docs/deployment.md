# Deployment checklist

The owner confirms that the active frontend host is Vercel and the backend is Render. The repository-root `vercel.json` selects `frontend/` as static output and defines the frontend routes and security headers. Public read-only checks on 2026-10-24 confirmed that `https://galala-university-study-plan-center.vercel.app` serves the admin page and its runtime config points to `https://galala-university-study-plan-full-stack-kd69.onrender.com/api`; the Render root returned 200 and unauthenticated `/api/catalog` returned 401. This is evidence that those hostnames are live, but does not confirm private dashboard settings.

The same checks found that the live Vercel response did not include the configured Content-Security-Policy, X-Frame-Options, Referrer-Policy, or Permissions-Policy headers. The live Render CORS preflight allowed `Content-Type` but not `Accept` or `X-Request-ID`, and the new public `/api/status` route was not yet available. The checked-in source configures these headers and CORS request headers, but those changes are not live until deployed. Verify the Vercel project root/output and dashboard header overrides in the owner dashboard, then recheck the deployed headers and preflight. Do not treat this repository change as resolving the live security-header gap.

## Backend On Render

Use `render.yaml` or create a Render Web Service manually. The manifest uses `npm ci` and starts only after configuration and database connectivity validation succeed.

- Root directory: repository root
- Build command: `npm ci`
- Start command: `npm run start`

Required env vars:

- `DATABASE_URL=<Supabase pooled Postgres URL>`
- `PG_SSL=true`
- `API_BASE_PATH=/api`
- `CORS_ORIGIN=<Vercel production site origin>`
- `JWT_SECRET=<long random secret>`
- `COOKIE_SECURE=true`
- `COOKIE_SAME_SITE=None` when the frontend and API have different origins
- `PORT=4000` if not supplied by Render

Set `NODE_ENV=production`. Do not set `CORS_ORIGIN=*`; startup rejects it. Keep the API deployment's public root route available for the host health check; `/api/health` is Super Admin-only.

## Frontend on Vercel

The static frontend files live in `frontend/`. Configure the Vercel project root as the repository root; `vercel.json` sets `frontend/` as output. It defines direct routes for `/`, `/student`, and `/admin`, while static `.html` pages and asset paths are served from the same output directory. Repository checks verify the checked-in configuration, not the private Vercel dashboard settings.

Set the backend API URL in `frontend/config.js`; the checked-in runtime default points to the confirmed Render API URL. Vercel dashboard build, environment, routing, and security-header settings remain external verification items.

The frontend API origin must be allowed by the backend's exact `CORS_ORIGIN`/`CORS_ORIGINS` configuration. Public checks confirmed the production frontend domain `https://galala-university-study-plan-center.vercel.app`; confirm the Render dashboard has that exact origin in `CORS_ORIGIN` or `CORS_ORIGINS`. `CORS_ORIGINS`, when non-empty, takes precedence over `CORS_ORIGIN`. Vercel preview origins should be added only if intentionally authorized.

The migration `20261024120000_admin_error_reports.sql` adds the Super Admin error-report inbox table. It is pending and has not been applied by this change. Before deploying the application code, review and apply this migration through the approved Supabase migration workflow; do not mark it applied manually. It enables and forces RLS without browser-facing policies; access is through backend API routes.

```js
window.__GU_API_BASE__ = 'https://your-render-backend.onrender.com/api';
```

The browser will also accept `?apiBase=https://your-render-backend.onrender.com/api` or the admin login API base field for temporary testing.

Because Vercel and Render are separate origins, `COOKIE_SAME_SITE=None` and HTTPS (`COOKIE_SECURE=true`) are required for login cookies to accompany API requests. Verify the routes and response headers in the authorized Vercel project/browser before a release; repository configuration cannot verify dashboard overrides or deployment state.

### Student password-reset email

For email-based student recovery, also configure `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, and `PUBLIC_APP_URL` as backend-only Render environment variables. Verify the Resend sending domain and sender before a controlled test. The API intentionally reports temporary unavailability when these values are missing or invalid; do not place the API key in Vercel or the frontend. See [student password reset by email](student-password-reset-email.md).

## Checks

Before deployment, from the repository root:

```bash
npm ci
npm run check
npm run test:migration-preflight
npm run db:preflight
npm run doctor
```

The migration preflight is read-only and must report every repository migration as applied with no unexpected versions before a release is considered schema-ready. Review and apply pending migrations through the approved Supabase migration workflow; do not run production migrations just to make the preflight green. Then deploy the backend, verify the health route, and deploy the static frontend using [the release and recovery runbook](release-and-recovery-runbook.md). Bootstrap is a one-time controlled operation only for a new installation; do not repeat it on an existing deployment.

- Render: `https://<backend>/` returns the landing page; verify authenticated `/api/health` as a Super Admin
- Student UI: `https://<site>/student`
- Admin UI: `https://<site>/admin`
- Landing page: `https://<site>/`
