BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS courses_name_lower_unique
  ON public.courses (lower(name));

CREATE UNIQUE INDEX IF NOT EXISTS program_courses_code_lower_unique
  ON public.program_courses (lower(code));

CREATE UNIQUE INDEX IF NOT EXISTS course_prerequisites_pair_unique
  ON public.course_prerequisites (course_id, prerequisite_course_id);

CREATE INDEX IF NOT EXISTS idx_course_prerequisites_visible_to_students
  ON public.course_prerequisites (visible_to_students);

COMMIT;
