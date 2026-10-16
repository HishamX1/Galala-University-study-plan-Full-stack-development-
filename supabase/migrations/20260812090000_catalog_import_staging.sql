BEGIN;

CREATE TABLE IF NOT EXISTS public.catalog_import_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  import_type text NOT NULL CHECK (import_type IN ('faculties', 'programs', 'programCourses', 'relationships')),
  import_format text NOT NULL CHECK (import_format IN ('json', 'csv', 'xlsx', 'pdf')),
  parsed_rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  validation jsonb NOT NULL DEFAULT '{}'::jsonb,
  reference_fingerprint text NOT NULL,
  preview_fingerprint text NOT NULL,
  preview_version integer NOT NULL DEFAULT 1 CHECK (preview_version > 0),
  status text NOT NULL DEFAULT 'staged' CHECK (status IN ('staged', 'published', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  published_at timestamptz,
  cancelled_at timestamptz,
  CHECK (jsonb_typeof(parsed_rows) = 'array'),
  CHECK (octet_length(parsed_rows::text) <= 10485760),
  CHECK (octet_length(validation::text) <= 1048576),
  CHECK ((status = 'published') = (published_at IS NOT NULL)),
  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_catalog_import_stages_owner_created
  ON public.catalog_import_stages (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_catalog_import_stages_expiry
  ON public.catalog_import_stages (expires_at);

ALTER TABLE public.catalog_import_stages ENABLE ROW LEVEL SECURITY;

COMMIT;
