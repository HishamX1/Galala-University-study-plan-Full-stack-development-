BEGIN;

CREATE INDEX IF NOT EXISTS idx_student_complaints_created_id
  ON public.student_complaints (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_communication_outbox_created_id
  ON public.communication_outbox (created_at DESC, id DESC);

COMMIT;
