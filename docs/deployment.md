# Deployment checklist

## Backend On Render

Use `render.yaml` or create a Render Web Service manually. The manifest uses `npm ci` and starts only after configuration and database connectivity validation succeed.

- Root directory: repository root
- Build command: `npm ci`
- Start command: `npm run start`

Required env vars:

- `DATABASE_URL=<Supabase pooled Postgres URL>`
- `PG_SSL=true`
- `API_BASE_PATH=/api`
- `CORS_ORIGIN=<Netlify site origin>`
- `JWT_SECRET=<long random secret>`
- `COOKIE_SECURE=true`
- `COOKIE_SAME_SITE=None` when the frontend and API have different origins
- `PORT=4000` if not supplied by Render

Set `NODE_ENV=production`. Do not set `CORS_ORIGIN=*`; startup rejects it. Keep the API deployment's public root route available for the host health check; `/api/health` is Super Admin-only.

## Frontend On Netlify

The root `netlify.toml` publishes `frontend`.

Set the deployed backend API URL in `frontend/config.js`:

```js
window.__GU_API_BASE__ = 'https://your-render-backend.onrender.com/api';
```

The browser will also accept `?apiBase=https://your-render-backend.onrender.com/api` or the admin login API base field for temporary testing.

The exact Netlify URL must be the backend `CORS_ORIGIN`. Because Netlify and Render are separate origins, `COOKIE_SAME_SITE=None` and HTTPS (`COOKIE_SECURE=true`) are required for login cookies to accompany API requests.

Netlify routes:

- `/` -> `index.html`
- `/student` -> `student/index.html`
- `/admin` -> `admin/index.html`

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
