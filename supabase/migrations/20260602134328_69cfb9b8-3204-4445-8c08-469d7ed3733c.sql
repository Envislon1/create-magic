
ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS firmware_version text,
  ADD COLUMN IF NOT EXISTS caregiver_email text,
  ADD COLUMN IF NOT EXISTS ota_url text,
  ADD COLUMN IF NOT EXISTS ota_version text,
  ADD COLUMN IF NOT EXISTS ota_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS ota_consumed_at timestamptz,
  ADD COLUMN IF NOT EXISTS ota_progress smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ota_status text NOT NULL DEFAULT 'idle';
