# Canonical Architecture

The live runtime is intentionally small:

`Netlify frontend -> Render backend API -> Supabase Postgres`

## Active Runtime

- Student UI: `frontend/student/index.html`
- Admin UI: `frontend/admin/index.html`
- Backend API: `backend/src/server.js`
- API routes: `backend/src/routes/catalogRoutes.js`
- Services: `backend/src/services/catalogService.js`
- Database client: `backend/src/db/client.js`

## Data Model

Only these Supabase tables are runtime sources:

- `faculties`
- `programs`
- `courses`
- `program_courses`
- `course_prerequisites`

The UI derives year and semester groupings from `program_courses.year_no` and `program_courses.semester_no`.

## Boundaries

- Frontend calls only `/api/*`.
- Backend is the only code that connects to Supabase.
- File-based stores and static data fallbacks are not part of the live runtime.
- Schema ownership stays in the complete, ordered SQL migration chain under `supabase/migrations/`. Apply every migration in filename order; no individual migration file represents the complete current schema. `npm run db:preflight` compares repository migration timestamps with Supabase's migration-history table and is read-only.

The repository-root tree is canonical. The previously referenced `modernization/` duplicate is absent from the current checkout and is not part of the runtime.
