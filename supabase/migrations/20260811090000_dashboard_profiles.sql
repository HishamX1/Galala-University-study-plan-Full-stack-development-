BEGIN;

ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS username text,
  ADD COLUMN IF NOT EXISTS avatar_key text NOT NULL DEFAULT 'avatar-1',
  ADD COLUMN IF NOT EXISTS avatar_data text,
  ADD COLUMN IF NOT EXISTS password_changed_at timestamptz;

UPDATE public.app_users
SET username = lower(regexp_replace(split_part(email, '@', 1), '[^a-zA-Z0-9_.]', '_', 'g'))
WHERE username IS NULL;

-- Existing accounts retain a deterministic, editable username. A UUID suffix
-- avoids collisions in legacy email local-parts without exposing identifiers.
UPDATE public.app_users
SET username = left(username, 14) || '_' || left(replace(id::text, '-', ''), 5)
WHERE username IS NOT NULL
  AND (length(username) < 3 OR length(username) > 20
       OR username !~ '^[A-Za-z0-9_.]+$'
       OR lower(username) IN ('admin','administrator','superadmin','system','support'));

CREATE UNIQUE INDEX IF NOT EXISTS app_users_username_lower_unique
  ON public.app_users (lower(username));

ALTER TABLE public.app_users
  ALTER COLUMN username SET NOT NULL;

COMMIT;
