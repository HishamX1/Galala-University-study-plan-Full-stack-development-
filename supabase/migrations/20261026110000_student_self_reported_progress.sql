BEGIN;

CREATE TABLE public.student_academic_profiles (
  user_id uuid PRIMARY KEY REFERENCES public.app_users(id) ON DELETE CASCADE,
  program_id bigint NOT NULL REFERENCES public.programs(id) ON DELETE RESTRICT,
  verified boolean NOT NULL DEFAULT false CHECK (verified = false),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.student_course_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  program_id bigint NOT NULL REFERENCES public.programs(id) ON DELETE RESTRICT,
  program_course_id bigint NOT NULL REFERENCES public.program_courses(id) ON DELETE RESTRICT,
  grade text NOT NULL CHECK (grade IN ('A+','A','A-','B+','B','B-','C+','C','C-','D+','D','F')),
  academic_year smallint NOT NULL CHECK (academic_year BETWEEN 2000 AND 2200),
  term text NOT NULL CHECK (length(trim(term)) BETWEEN 1 AND 40),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX student_course_attempts_owner_program_term_idx ON public.student_course_attempts(user_id, program_id, academic_year, term);
CREATE INDEX student_course_attempts_course_idx ON public.student_course_attempts(program_course_id);
ALTER TABLE public.student_academic_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_course_attempts ENABLE ROW LEVEL SECURITY;

COMMIT;
