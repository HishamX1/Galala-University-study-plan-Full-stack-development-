BEGIN;

ALTER TABLE public.faculties
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by text,
  ADD COLUMN IF NOT EXISTS delete_reason text;

ALTER TABLE public.programs
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by text,
  ADD COLUMN IF NOT EXISTS delete_reason text;

ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by text,
  ADD COLUMN IF NOT EXISTS delete_reason text;

ALTER TABLE public.program_courses
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by text,
  ADD COLUMN IF NOT EXISTS delete_reason text;

ALTER TABLE public.course_prerequisites
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by text,
  ADD COLUMN IF NOT EXISTS delete_reason text;

CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  admin_user text NOT NULL DEFAULT 'Admin',
  action text NOT NULL,
  entity text NOT NULL,
  entity_id bigint,
  old_values jsonb,
  new_values jsonb,
  description text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS public.admin_backup_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  admin_user text NOT NULL DEFAULT 'Admin',
  format text NOT NULL CHECK (format IN ('json', 'csv', 'sql')),
  scope text NOT NULL DEFAULT 'catalog',
  record_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  snapshot jsonb,
  description text NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_faculties_deleted_at ON public.faculties (deleted_at);
CREATE INDEX IF NOT EXISTS idx_programs_deleted_at ON public.programs (deleted_at);
CREATE INDEX IF NOT EXISTS idx_courses_deleted_at ON public.courses (deleted_at);
CREATE INDEX IF NOT EXISTS idx_program_courses_deleted_at ON public.program_courses (deleted_at);
CREATE INDEX IF NOT EXISTS idx_course_prerequisites_deleted_at ON public.course_prerequisites (deleted_at);
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created_at ON public.admin_audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_entity_action ON public.admin_audit_logs (entity, action);
CREATE INDEX IF NOT EXISTS idx_admin_backup_history_created_at ON public.admin_backup_history (created_at DESC);

COMMIT;
