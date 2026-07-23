-- Add storage-path based OTA. Keeps existing ota_url for backward-compat but
-- new uploads use ota_storage_path; device.sync generates a signed URL.
ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS ota_storage_path TEXT,
  ADD COLUMN IF NOT EXISTS ota_uploaded_at  TIMESTAMPTZ;