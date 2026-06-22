# Galala University Study Plan Platform

This repository now has one live architecture:

`Netlify frontend -> Backend API -> Supabase Postgres`

The active application lives in `modernization/`. The old static/file-based runtime has been removed from the live path.

## Runtime Entry Points

- Student UI: `modernization/frontend/student/index.html`
- Admin UI: `modernization/frontend/admin/index.html`
- Landing page: `modernization/frontend/index.html`
- Backend API: `modernization/backend/src/server.js`
- Netlify config: `netlify.toml`
- Render backend config: `modernization/render.yaml`
- Supabase schema: `supabase/migrations/20260420120000_init_schema.sql`
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
cd modernization
npm install
$env:DATABASE_URL="<supabase-postgres-url>"
$env:PG_SSL="true"
npm run start
```

Then open:

- `http://localhost:4000/`
- `http://localhost:4000/admin`

## Deployment

1. Deploy the backend on Render from `modernization/`.
2. Set `DATABASE_URL`, `PG_SSL=true`, `API_BASE_PATH=/api`, and `CORS_ORIGIN=<your Netlify origin>`.
3. Set the frontend backend URL in `modernization/frontend/config.js`, for example `window.__GU_API_BASE__ = 'https://your-render-backend.onrender.com/api';`.
4. Deploy the repository to Netlify. Netlify publishes `modernization/frontend`; `/`, `/student`, and `/admin` load the canonical landing/student/admin pages.

## Verification

From `modernization`:

```bash
npm run check
npm run smoke
```

`npm run smoke` expects the backend to be running on port `4000` with a configured Supabase database.
