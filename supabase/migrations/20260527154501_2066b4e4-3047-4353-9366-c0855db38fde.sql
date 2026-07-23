
-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  phone TEXT,
  emergency_contact_name TEXT,
  emergency_contact_phone TEXT,
  role text NOT NULL DEFAULT 'patient' CHECK (role IN ('patient','caregiver')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "self read profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "self insert profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "self update profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

-- Devices
CREATE TABLE public.devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Mind Companion',
  pairing_code TEXT NOT NULL UNIQUE,
  current_mode TEXT DEFAULT 'ANXIETY',
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.devices TO authenticated;
GRANT ALL ON public.devices TO service_role;
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own devices" ON public.devices FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- SOS events
CREATE TABLE public.sos_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id UUID REFERENCES public.devices(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'device',
  status TEXT NOT NULL DEFAULT 'active',
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sos_events TO authenticated;
GRANT ALL ON public.sos_events TO service_role;
ALTER TABLE public.sos_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own sos" ON public.sos_events FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
ALTER PUBLICATION supabase_realtime ADD TABLE public.sos_events;
ALTER TABLE public.sos_events REPLICA IDENTITY FULL;

-- Medication schedules
CREATE TABLE public.medication_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT 'Medication',
  hour SMALLINT NOT NULL DEFAULT 20,
  minute SMALLINT NOT NULL DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.medication_schedules TO authenticated;
GRANT ALL ON public.medication_schedules TO service_role;
ALTER TABLE public.medication_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own meds" ON public.medication_schedules FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
ALTER PUBLICATION supabase_realtime ADD TABLE public.medication_schedules;

-- Mode history
CREATE TABLE public.mode_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mode_history TO authenticated;
GRANT ALL ON public.mode_history TO service_role;
ALTER TABLE public.mode_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own mode hist" ON public.mode_history FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Chat messages
CREATE TABLE public.chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  mode TEXT,
  conversation text NOT NULL DEFAULT 'guardian_ai',
  recipient_id uuid,
  read_at timestamptz,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_messages TO authenticated;
GRANT ALL ON public.chat_messages TO service_role;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view own or care chats" ON public.chat_messages FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR auth.uid() = recipient_id);
CREATE POLICY "insert own chats" ON public.chat_messages FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "update own chat read state" ON public.chat_messages FOR UPDATE TO authenticated
  USING (auth.uid() = recipient_id OR auth.uid() = user_id);
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.devices;

-- Caregiver links
CREATE TABLE public.caregiver_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  caregiver_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  device_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (caregiver_id, patient_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.caregiver_links TO authenticated;
GRANT ALL ON public.caregiver_links TO service_role;
ALTER TABLE public.caregiver_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "caregiver or patient can view link" ON public.caregiver_links FOR SELECT TO authenticated
  USING (auth.uid() = caregiver_id OR auth.uid() = patient_id);
CREATE POLICY "caregiver creates link" ON public.caregiver_links FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = caregiver_id);
CREATE POLICY "either party deletes link" ON public.caregiver_links FOR DELETE TO authenticated
  USING (auth.uid() = caregiver_id OR auth.uid() = patient_id);

-- Profile auto-create
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email,'@',1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'patient')
  )
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
