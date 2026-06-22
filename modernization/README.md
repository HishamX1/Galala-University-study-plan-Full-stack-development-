# GU Platform Modernization

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
