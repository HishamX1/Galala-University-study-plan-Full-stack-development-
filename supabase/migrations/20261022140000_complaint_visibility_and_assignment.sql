BEGIN;

ALTER TABLE public.student_complaints
  ADD COLUMN IF NOT EXISTS submitted_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS submitted_name text,
  ADD COLUMN IF NOT EXISTS last_modified_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz;

-- Backfill only identities that can be matched unambiguously to the stored
-- registered email. Unmatched legacy rows remain explicitly unidentified.
UPDATE public.student_complaints AS complaint
   SET submitted_by = matched.id,
       submitted_name = matched.name
  FROM (
    SELECT lower(email) AS email_key,
           (array_agg(id))[1] AS id,
           (array_agg(name))[1] AS name
      FROM public.app_users
     WHERE role = 'student'
     GROUP BY lower(email)
    HAVING count(*) = 1
  ) AS matched
 WHERE complaint.submitted_by IS NULL
   AND matched.email_key = lower(complaint.email);

-- Existing handled_by values were written by the complaint update workflow;
-- preserve them as modifier identity, but never infer assignment from them.
UPDATE public.student_complaints
   SET last_modified_by = handled_by
 WHERE last_modified_by IS NULL
   AND handled_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_student_complaints_submitted_created
  ON public.student_complaints (submitted_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_student_complaints_assignee_status
  ON public.student_complaints (assigned_to, status, updated_at DESC);

COMMIT;
