BEGIN;

CREATE TABLE IF NOT EXISTS public.notification_read_states (
  user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  notification_type text NOT NULL CHECK (notification_type IN (
    'communication', 'password_reset_request', 'complaint', 'backup'
  )),
  source_id text NOT NULL CHECK (length(source_id) BETWEEN 1 AND 64),
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, notification_type, source_id)
);

ALTER TABLE public.notification_read_states ENABLE ROW LEVEL SECURITY;

COMMIT;
