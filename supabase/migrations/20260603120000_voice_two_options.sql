-- Voice selection is now Female / Male only. Collapse any legacy values
-- (neutral, warm, or anything unexpected) to 'female' so dashboard + device
-- never see an option that no longer exists.
UPDATE public.devices
   SET preferred_voice = 'female'
 WHERE preferred_voice IS NULL
    OR preferred_voice NOT IN ('female', 'male');

ALTER TABLE public.devices
  DROP CONSTRAINT IF EXISTS devices_preferred_voice_check;

ALTER TABLE public.devices
  ADD CONSTRAINT devices_preferred_voice_check
  CHECK (preferred_voice IN ('female', 'male'));
