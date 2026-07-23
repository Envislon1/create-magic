
-- Helper: is the current user a caregiver linked to patient _pid?
CREATE OR REPLACE FUNCTION public.is_caregiver_of(_pid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.caregiver_links
    WHERE caregiver_id = auth.uid() AND patient_id = _pid
  );
$$;

-- profiles: caregiver can read patient's profile
DROP POLICY IF EXISTS "caregiver reads linked patient profile" ON public.profiles;
CREATE POLICY "caregiver reads linked patient profile"
ON public.profiles FOR SELECT TO authenticated
USING (public.is_caregiver_of(id));

-- devices: caregiver can read patient's device
DROP POLICY IF EXISTS "caregiver reads linked patient device" ON public.devices;
CREATE POLICY "caregiver reads linked patient device"
ON public.devices FOR SELECT TO authenticated
USING (public.is_caregiver_of(user_id));

-- medication_schedules: caregiver can read patient's meds
DROP POLICY IF EXISTS "caregiver reads linked patient meds" ON public.medication_schedules;
CREATE POLICY "caregiver reads linked patient meds"
ON public.medication_schedules FOR SELECT TO authenticated
USING (public.is_caregiver_of(user_id));

-- sos_events: caregiver can read AND resolve patient's SOS events
DROP POLICY IF EXISTS "caregiver reads linked patient sos" ON public.sos_events;
CREATE POLICY "caregiver reads linked patient sos"
ON public.sos_events FOR SELECT TO authenticated
USING (public.is_caregiver_of(user_id));

DROP POLICY IF EXISTS "caregiver resolves linked patient sos" ON public.sos_events;
CREATE POLICY "caregiver resolves linked patient sos"
ON public.sos_events FOR UPDATE TO authenticated
USING (public.is_caregiver_of(user_id))
WITH CHECK (public.is_caregiver_of(user_id));
