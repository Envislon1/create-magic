ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS ota_url           TEXT,
  ADD COLUMN IF NOT EXISTS ota_version       TEXT,
  ADD COLUMN IF NOT EXISTS ota_requested_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ota_consumed_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ota_progress      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ota_status        TEXT    NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS firmware_version  TEXT,
  ADD COLUMN IF NOT EXISTS caregiver_email   TEXT;

ALTER TABLE public.sos_events
  ADD COLUMN IF NOT EXISTS notification_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS notification_error   TEXT;