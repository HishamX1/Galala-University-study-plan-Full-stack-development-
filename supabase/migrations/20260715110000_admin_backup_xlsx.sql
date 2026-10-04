BEGIN;

ALTER TABLE public.admin_backup_history
  DROP CONSTRAINT IF EXISTS admin_backup_history_format_check;

ALTER TABLE public.admin_backup_history
  ADD CONSTRAINT admin_backup_history_format_check
  CHECK (format IN ('json', 'csv', 'sql', 'xlsx'));

COMMIT;
