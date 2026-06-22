# Supabase Setup

The app expects the canonical Supabase schema already agreed for this project.

## Schema

Use:

- `../../supabase/migrations/20260420120000_init_schema.sql`

This creates:

- `faculties`
- `programs`
- `courses`
- `program_courses`
- `course_prerequisites`

## Seed

Use:

- `../../supabase/seed.sql`

Apply it from the Supabase SQL editor or your preferred database workflow. The runtime app does not reset or migrate the database on startup.

## Backend Env

```dotenv
DATABASE_URL=postgresql://...
PG_SSL=true
API_BASE_PATH=/api
CORS_ORIGIN=https://your-netlify-site.netlify.app
```

## Verification

Start the backend and check:

```bash
curl http://localhost:4000/api/health
curl http://localhost:4000/api/faculties
curl http://localhost:4000/api/program-courses
```
