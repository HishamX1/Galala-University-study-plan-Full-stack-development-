BEGIN;

CREATE TABLE IF NOT EXISTS public.faculties (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.programs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  faculty_id bigint NOT NULL REFERENCES public.faculties(id) ON DELETE CASCADE,
  name text NOT NULL,
  duration_years smallint NOT NULL CHECK (duration_years IN (4, 5)),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT programs_faculty_name_key UNIQUE (faculty_id, name)
);

CREATE TABLE IF NOT EXISTS public.courses (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL UNIQUE,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.program_courses (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  program_id bigint NOT NULL REFERENCES public.programs(id) ON DELETE CASCADE,
  course_id bigint NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  code text NOT NULL,
  year_no smallint NOT NULL CHECK (year_no BETWEEN 1 AND 5),
  semester_no smallint NOT NULL CHECK (semester_no BETWEEN 1 AND 10),
  is_required boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  credits smallint NOT NULL DEFAULT 0,
  CONSTRAINT program_courses_program_course_key UNIQUE (program_id, course_id),
  CONSTRAINT program_courses_program_code_key UNIQUE (program_id, code)
);

CREATE TABLE IF NOT EXISTS public.course_prerequisites (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  course_id bigint NOT NULL REFERENCES public.program_courses(id) ON DELETE CASCADE,
  prerequisite_course_id bigint NOT NULL REFERENCES public.program_courses(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT course_prerequisites_course_prerequisite_key UNIQUE (course_id, prerequisite_course_id),
  CONSTRAINT course_prerequisites_no_self CHECK (course_id <> prerequisite_course_id)
);

ALTER TABLE public.faculties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.program_courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_prerequisites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enable read access for all users" ON public.faculties;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.programs;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.courses;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.program_courses;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.course_prerequisites;

CREATE POLICY "Enable read access for all users"
  ON public.faculties
  FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Enable read access for all users"
  ON public.programs
  FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Enable read access for all users"
  ON public.courses
  FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Enable read access for all users"
  ON public.program_courses
  FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Enable read access for all users"
  ON public.course_prerequisites
  FOR SELECT
  TO public
  USING (true);

CREATE INDEX IF NOT EXISTS idx_programs_faculty_id ON public.programs (faculty_id);
CREATE INDEX IF NOT EXISTS idx_program_courses_program_id ON public.program_courses (program_id);
CREATE INDEX IF NOT EXISTS idx_program_courses_course_id ON public.program_courses (course_id);
CREATE INDEX IF NOT EXISTS idx_program_courses_year_no ON public.program_courses (year_no);
CREATE INDEX IF NOT EXISTS idx_program_courses_semester_no ON public.program_courses (semester_no);
CREATE INDEX IF NOT EXISTS idx_course_prerequisites_course_id ON public.course_prerequisites (course_id);
CREATE INDEX IF NOT EXISTS idx_course_prerequisites_prerequisite_course_id ON public.course_prerequisites (prerequisite_course_id);

COMMIT;
