BEGIN;

CREATE TABLE public.admin_error_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  reporter_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  reporter_role text NOT NULL CHECK (reporter_role IN ('regular_admin', 'super_admin')),
  category text NOT NULL CHECK (category IN ('api', 'authentication', 'catalog', 'import', 'network', 'ui', 'other')),
  severity text NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  message text NOT NULL CHECK (length(message) BETWEEN 5 AND 1000),
  technical_details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (octet_length(technical_details::text) <= 4096),
  request_id text CHECK (request_id IS NULL OR length(request_id) <= 128),
  page text NOT NULL DEFAULT '' CHECK (length(page) <= 160),
  endpoint text NOT NULL DEFAULT '' CHECK (length(endpoint) <= 300),
  method text CHECK (method IS NULL OR method IN ('GET', 'POST', 'PUT', 'PATCH', 'DELETE')),
  user_agent text NOT NULL DEFAULT '' CHECK (length(user_agent) <= 300),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewing', 'resolved')),
  resolution_notes text CHECK (resolution_notes IS NULL OR length(resolution_notes) <= 2000),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES public.app_users(id) ON DELETE RESTRICT,
  CHECK ((status = 'resolved') = (resolved_at IS NOT NULL AND resolved_by IS NOT NULL))
);

CREATE INDEX admin_error_reports_inbox_idx ON public.admin_error_reports (status, category, created_at DESC);
CREATE INDEX admin_error_reports_reporter_idx ON public.admin_error_reports (reporter_id, created_at DESC);
ALTER TABLE public.admin_error_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_error_reports FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE public.admin_error_reports IS 'Sanitized administrator error reports; access is mediated by the authenticated backend API.';

COMMIT;
