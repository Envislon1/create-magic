ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS sound_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS preferred_voice text NOT NULL DEFAULT 'female',
  ADD COLUMN IF NOT EXISTS speaker_volume smallint NOT NULL DEFAULT 70
    CHECK (speaker_volume BETWEEN 0 AND 100);
