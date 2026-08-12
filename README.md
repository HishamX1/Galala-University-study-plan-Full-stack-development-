# GU Platform Modernization

## Production authentication deployment

1. Apply all Supabase migrations, including `supabase/migrations/20260718090000_authentication.sql`.
2. Configure `DATABASE_URL`, a long random `JWT_SECRET`, `CORS_ORIGIN` set to the exact frontend origin (for example `https://study-plan.galala.edu.eg`), `PG_SSL=true`, `COOKIE_SECURE=true`, and `COOKIE_SAME_SITE=None` when Netlify and Render use different origins. Production startup refuses a missing `DATABASE_URL` or `JWT_SECRET`, and refuses missing or wildcard `CORS_ORIGIN`.
3. From `modernization/`, run `npm run bootstrap-super-admin`. Enter the initial administrator's name, email, and a confirmed strong password. The password is hidden while typing and is hashed through the standard authentication service.
4. Sign in as that Super Admin at `/login.html`, then use **User Management** to create Regular Admin and Student accounts.
5. Bootstrap automatically and permanently becomes unavailable once any account exists: later invocations print `Bootstrap skipped. Users already exist.` No public bootstrap API exists.
6. Use `npm run reset-super-admin-password` or `npm run reset-user-password` for password recovery. Both commands validate and hide the new password, then verify the stored bcrypt hash before reporting success.

For local development, `CORS_ORIGIN=http://localhost:4000` is the default; set it explicitly if the frontend uses another local origin (for example `http://127.0.0.1:5500`). Development permits a JWT fallback but logs a warning—never use it in production. Never commit secrets or credentials.

Environment files are loaded in this order, with later files overriding earlier files: `.env`, `.env.development` or `.env.production`, then `.env.local`. Environment values supplied by the host/shell always have highest priority. Run `npm run doctor` before every deployment; it checks configuration, connectivity, migrations, bootstrap state, frontend API configuration, and Render/Netlify manifests.

### Session policy

The only authentication cookies are `gu_access` and `gu_refresh`. Both are `HttpOnly`, `Path=/`, host-only, and use the configured `SameSite` and `Secure` values. Access tokens last 300 seconds for every role. Student and Regular Admin refresh sessions last seven days; Super Admin refresh sessions last 90 days. Refresh tokens rotate on every renewal. Logout revokes the active refresh token, clears both cookies and client-side authenticated-state cache, and returns to the public landing page. The frontend never stores passwords or tokens.

Local development uses `SameSite=Lax` without `Secure`; production requires explicit `CORS_ORIGIN`, `COOKIE_SECURE=true`, and `COOKIE_SAME_SITE=None` for credentialed Netlify-to-Render requests.

`modernization/` is the only active runtime for the study-plan app.

## Runtime Flow

`Frontend -> Backend API -> Supabase Postgres`

The frontend never talks directly to Supabase. The backend is the single runtime data source.

## Components

- Backend server: `backend/src/server.js`
- API routes: `backend/src/routes/catalogRoutes.js`
- Domain service: `backend/src/services/catalogService.js`
- Postgres client: `backend/src/db/client.js`
- Student UI: `frontend/student/index.html`
- Admin UI: `frontend/admin/index.html`
- Landing page: `frontend/index.html`

## Canonical Data Model

- `faculties`
- `programs`
- `courses`
- `program_courses`
- `course_prerequisites`

`program_courses.year_no` and `program_courses.semester_no` provide the year/semester grouping shown in the UI.

## API

- `GET /api/health`
- `GET /api/catalog`
- `GET/POST /api/faculties`
- `PUT/DELETE /api/faculties/:id`
- `GET/POST /api/programs`
- `PUT/DELETE /api/programs/:id`
- `GET/POST /api/program-courses`
- `PUT/DELETE /api/program-courses/:id`
- `GET/PUT /api/program-courses/:id/prerequisites`

Legacy static data paths are not part of the runtime. The frontend uses only the backend API.

## Environment

Required backend values:

- `DATABASE_URL`
- `PG_SSL=true` for Supabase pooled connections
- `API_BASE_PATH=/api`
- `CORS_ORIGIN=<frontend origin>`
- `PORT=4000` locally or the host-provided port in production

Frontend deployments can set `window.__GU_API_BASE__` in `frontend/config.js` to the external backend API URL. In local static development, the frontend falls back to `http://127.0.0.1:4000/api`.

## Commands

```bash
npm install
npm run check
npm run start
```

With the backend running:

```bash
npm run smoke
```
