BEGIN;

ALTER TABLE public.course_prerequisites
  ADD COLUMN IF NOT EXISTS visible_to_students boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_course_prerequisites_visible_to_students
  ON public.course_prerequisites (visible_to_students);

COMMIT;
