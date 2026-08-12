# Deployment checklist

## Backend On Render

Use `modernization/render.yaml` or create a Render Web Service manually. The manifest uses `npm ci` and starts only after configuration and database connectivity validation succeed.

- Root directory: `modernization`
- Build command: `npm install`
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

The root `netlify.toml` publishes `modernization/frontend`.

Set the deployed backend API URL in `modernization/frontend/config.js`:

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

Before deployment, from `modernization/`:

```bash
npm ci
npm run check
npm run doctor
```

Apply the Supabase migrations, deploy the backend, then run `npm run bootstrap-super-admin` once from a controlled environment. Sign in as that account and create the remaining administrator and student users. Bootstrap is automatically disabled after the first account exists.

- Render: `https://<backend>/` returns the landing page; verify authenticated `/api/health` as a Super Admin
- Student UI: `https://<site>/student`
- Admin UI: `https://<site>/admin`
- Landing page: `https://<site>/`
