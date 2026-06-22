# Deployment

## Backend On Render

Use `modernization/render.yaml` or create a Render Web Service manually.

- Root directory: `modernization`
- Build command: `npm install`
- Start command: `npm run start`

Required env vars:

- `DATABASE_URL=<Supabase pooled Postgres URL>`
- `PG_SSL=true`
- `API_BASE_PATH=/api`
- `CORS_ORIGIN=<Netlify site origin>`
- `PORT=4000` if not supplied by Render

## Frontend On Netlify

The root `netlify.toml` publishes `modernization/frontend`.

Set the deployed backend API URL in `modernization/frontend/config.js`:

```js
window.__GU_API_BASE__ = 'https://your-render-backend.onrender.com/api';
```

The browser will also accept `?apiBase=https://your-render-backend.onrender.com/api` or the admin login API base field for temporary testing.

Netlify routes:

- `/` -> `index.html`
- `/student` -> `student/index.html`
- `/admin` -> `admin/index.html`

## Checks

- Render: `https://<backend>/api/health`
- Student UI: `https://<site>/student`
- Admin UI: `https://<site>/admin`
- Landing page: `https://<site>/`
