BEGIN;

ALTER TABLE public.student_academic_profiles
  ADD COLUMN total_program_credits smallint CHECK (total_program_credits BETWEEN 1 AND 1000),
  ADD COLUMN target_gpa numeric(3,2) CHECK (target_gpa BETWEEN 0 AND 4);

COMMENT ON COLUMN public.student_academic_profiles.total_program_credits IS
  'Student-reported total program credits; not an official catalog requirement.';
COMMENT ON COLUMN public.student_academic_profiles.target_gpa IS
  'Student-set GPA goal on the configured 0.00 to 4.00 planning scale.';

COMMIT;
