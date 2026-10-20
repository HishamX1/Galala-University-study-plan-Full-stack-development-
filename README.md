# Galala University Study Plan Platform

This repository now has one live architecture:

`Netlify frontend -> Backend API -> Supabase Postgres`

The canonical application lives at the repository root. The previously referenced `modernization/` duplicate is absent from this checkout; root `backend/` and `frontend/` are the application trees present here.

## Runtime Entry Points

- Student UI: `frontend/student/index.html`
- Admin UI: `frontend/admin/index.html`
- Landing page: `frontend/index.html`
- Backend API: `backend/src/server.js`
- Netlify config: `netlify.toml`
- Render backend config: `render.yaml`
- Supabase schema: the complete ordered migration chain in `supabase/migrations/`
- Supabase seed: `supabase/seed.sql`

## Canonical Schema

The backend reads and writes only:

- `faculties`
- `programs`
- `courses`
- `program_courses`
- `course_prerequisites`

Years and semesters are derived from `program_courses.year_no` and `program_courses.semester_no`.

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

## Local Backend

```bash
npm install
$env:DATABASE_URL="<supabase-postgres-url>"
$env:PG_SSL="true"
npm run start
```

Then open:

- `http://localhost:4000/`
- `http://localhost:4000/admin`

## Deployment

1. Deploy the backend on Render from the repository root.
2. Set `DATABASE_URL`, `PG_SSL=true`, `API_BASE_PATH=/api`, and `CORS_ORIGIN=<your Netlify origin>`.
3. Set the frontend backend URL in `frontend/config.js`, for example `window.__GU_API_BASE__ = 'https://your-render-backend.onrender.com/api';`.
4. Deploy the repository to Netlify. Netlify publishes `frontend`; `/`, `/student`, and `/admin` load the canonical landing/student/admin pages.

## Verification

From the repository root:

```bash
npm run check
npm run smoke
```

`npm run db:preflight` is a read-only check of the Supabase migration-history table. It requires `DATABASE_URL` and returns failure if migration history is missing, unreadable, or differs from the repository. It does not apply migrations. `npm run smoke` expects the backend to be running on port `4000` with a configured database.
