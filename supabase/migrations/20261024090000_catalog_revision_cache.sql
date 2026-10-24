BEGIN;

CREATE TABLE IF NOT EXISTS public.catalog_revision_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.catalog_revision_state (singleton, revision)
VALUES (true, 1)
ON CONFLICT (singleton) DO NOTHING;

ALTER TABLE public.catalog_revision_state ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.get_catalog_revision()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT revision FROM public.catalog_revision_state WHERE singleton = true
$$;

CREATE OR REPLACE FUNCTION public.bump_catalog_revision_from_statement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  changed_rows boolean := false;
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I)', TG_TABLE_NAME) INTO changed_rows;
  ELSIF TG_OP = 'DELETE' THEN
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I)', TG_ARGV[0]) INTO changed_rows;
  ELSE
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I)', TG_ARGV[0]) INTO changed_rows;
  END IF;

  IF changed_rows THEN
    UPDATE public.catalog_revision_state
       SET revision = revision + 1,
           updated_at = clock_timestamp()
     WHERE singleton = true;
  END IF;
  RETURN NULL;
END;
$$;

COMMENT ON TABLE public.catalog_revision_state IS
  'Transactional cross-instance version for cached student/admin catalog snapshots.';

DO $$
DECLARE
  catalog_table text;
  trigger_event text;
  transition_name text;
  trigger_name text;
BEGIN
  FOREACH catalog_table IN ARRAY ARRAY[
    'faculties', 'programs', 'courses', 'program_courses', 'course_prerequisites'
  ] LOOP
    FOREACH trigger_event IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] LOOP
      trigger_name := format('catalog_revision_%s_%s', catalog_table, lower(trigger_event));
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', trigger_name, catalog_table);

      IF trigger_event = 'INSERT' THEN
        transition_name := 'new_rows';
        EXECUTE format(
          'CREATE TRIGGER %I AFTER INSERT ON public.%I REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.bump_catalog_revision_from_statement(%L)',
          trigger_name, catalog_table, transition_name
        );
      ELSIF trigger_event = 'UPDATE' THEN
        transition_name := 'new_rows';
        EXECUTE format(
          'CREATE TRIGGER %I AFTER UPDATE ON public.%I REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.bump_catalog_revision_from_statement(%L)',
          trigger_name, catalog_table, transition_name
        );
      ELSIF trigger_event = 'DELETE' THEN
        transition_name := 'old_rows';
        EXECUTE format(
          'CREATE TRIGGER %I AFTER DELETE ON public.%I REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.bump_catalog_revision_from_statement(%L)',
          trigger_name, catalog_table, transition_name
        );
      ELSE
        EXECUTE format(
          'CREATE TRIGGER %I BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.bump_catalog_revision_from_statement()',
          trigger_name, catalog_table
        );
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

COMMIT;
