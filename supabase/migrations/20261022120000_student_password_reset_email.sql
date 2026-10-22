BEGIN;

ALTER TABLE public.password_reset_tokens
  ADD COLUMN IF NOT EXISTS delivery_source text NOT NULL DEFAULT 'admin_approval'
  CHECK (delivery_source IN ('admin_approval', 'student_email'));

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_student_email_rate
  ON public.password_reset_tokens (user_id, created_at DESC)
  WHERE delivery_source = 'student_email';

COMMIT;
