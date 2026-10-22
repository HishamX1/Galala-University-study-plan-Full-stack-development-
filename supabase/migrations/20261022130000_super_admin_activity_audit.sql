BEGIN;

ALTER TABLE public.admin_audit_logs
  ADD COLUMN IF NOT EXISTS actor_id uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS actor_role text,
  ADD COLUMN IF NOT EXISTS actor_name text,
  ADD COLUMN IF NOT EXISTS outcome text NOT NULL DEFAULT 'success',
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'admin',
  ADD COLUMN IF NOT EXISTS target_id text,
  ADD COLUMN IF NOT EXISTS request_id text;

ALTER TABLE public.admin_audit_logs
  ADD CONSTRAINT admin_audit_logs_outcome_check CHECK (outcome IN ('success', 'failure')),
  ADD CONSTRAINT admin_audit_logs_category_check CHECK (category IN ('catalog', 'import', 'backup', 'admin', 'account', 'security', 'request', 'communication'));

-- The backend uses PostgreSQL for audit access. With no policies, browser and
-- public API roles cannot read or alter the audit table directly.
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_actor_created
  ON public.admin_audit_logs (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_category_created
  ON public.admin_audit_logs (category, created_at DESC);

COMMIT;
