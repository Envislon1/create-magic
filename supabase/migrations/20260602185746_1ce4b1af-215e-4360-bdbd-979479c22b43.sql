-- Fresh schema for new Lovable Cloud project

-- 1. App roles enum
CREATE TYPE public.app_role AS ENUM ('patient', 'caregiver', 'admin');

-- 2. Profiles
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  phone text,
  emergency_contact_name text,
  emergency_contact_phone text,
  role public.app_role NOT NULL DEFAULT 'patient',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles read all auth" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles self update" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "profiles self insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

-- 3. User roles
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "roles self read" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- 4. has_role helper
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- 5. Devices (created before caregiver_links so caregiver_links can FK to it)
CREATE TABLE public.devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Mind Companion',
  pairing_code text NOT NULL UNIQUE,
  current_mode text DEFAULT 'ANXIETY',
  last_seen_at timestamptz,
  firmware_version text,
  caregiver_email text,
  ota_url text,
  ota_version text,
  ota_requested_at timestamptz,
  ota_consumed_at timestamptz,
  ota_progress smallint NOT NULL DEFAULT 0,
  ota_status text NOT NULL DEFAULT 'idle',
  ota_storage_path text,
  ota_uploaded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.devices(user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.devices TO authenticated;
GRANT ALL ON public.devices TO service_role;
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "devices owner all" ON public.devices FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 6. Caregiver links
CREATE TABLE public.caregiver_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  caregiver_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id uuid REFERENCES public.devices(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (caregiver_id, patient_id)
);
CREATE INDEX ON public.caregiver_links(caregiver_id);
CREATE INDEX ON public.caregiver_links(patient_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.caregiver_links TO authenticated;
GRANT ALL ON public.caregiver_links TO service_role;
ALTER TABLE public.caregiver_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "links read participant" ON public.caregiver_links FOR SELECT TO authenticated
  USING (auth.uid() = caregiver_id OR auth.uid() = patient_id);
CREATE POLICY "links caregiver insert" ON public.caregiver_links FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = caregiver_id);
CREATE POLICY "links participant delete" ON public.caregiver_links FOR DELETE TO authenticated
  USING (auth.uid() = caregiver_id OR auth.uid() = patient_id);

-- 7. is_caregiver_of helper (after caregiver_links exists)
CREATE OR REPLACE FUNCTION public.is_caregiver_of(_pid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(SELECT 1 FROM public.caregiver_links WHERE caregiver_id = auth.uid() AND patient_id = _pid)
$$;

-- 8. Add caregiver read policy to devices (after is_caregiver_of exists)
CREATE POLICY "devices caregiver read" ON public.devices FOR SELECT TO authenticated
  USING (public.is_caregiver_of(user_id));

-- 9. SOS events
CREATE TABLE public.sos_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id uuid REFERENCES public.devices(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'app',
  status text NOT NULL DEFAULT 'active',
  note text,
  notification_sent_at timestamptz,
  notification_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX ON public.sos_events(user_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sos_events TO authenticated;
GRANT ALL ON public.sos_events TO service_role;
ALTER TABLE public.sos_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sos owner all" ON public.sos_events FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "sos caregiver read" ON public.sos_events FOR SELECT TO authenticated
  USING (public.is_caregiver_of(user_id));
CREATE POLICY "sos caregiver update" ON public.sos_events FOR UPDATE TO authenticated
  USING (public.is_caregiver_of(user_id));

-- 10. Medication schedules
CREATE TABLE public.medication_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label text NOT NULL DEFAULT 'Medication',
  hour int NOT NULL DEFAULT 20 CHECK (hour BETWEEN 0 AND 23),
  minute int NOT NULL DEFAULT 0 CHECK (minute BETWEEN 0 AND 59),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.medication_schedules(user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.medication_schedules TO authenticated;
GRANT ALL ON public.medication_schedules TO service_role;
ALTER TABLE public.medication_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "meds owner all" ON public.medication_schedules FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "meds caregiver read" ON public.medication_schedules FOR SELECT TO authenticated
  USING (public.is_caregiver_of(user_id));

-- 11. Mode history
CREATE TABLE public.mode_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mode text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.mode_history(user_id, created_at DESC);
GRANT SELECT, INSERT ON public.mode_history TO authenticated;
GRANT ALL ON public.mode_history TO service_role;
ALTER TABLE public.mode_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mode owner read" ON public.mode_history FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "mode owner insert" ON public.mode_history FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "mode caregiver read" ON public.mode_history FOR SELECT TO authenticated
  USING (public.is_caregiver_of(user_id));

-- 12. Chat messages
CREATE TABLE public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'user',
  content text NOT NULL,
  conversation text NOT NULL DEFAULT 'guardian_ai',
  mode text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.chat_messages(user_id, created_at);
CREATE INDEX ON public.chat_messages(recipient_id, created_at);
GRANT SELECT, INSERT ON public.chat_messages TO authenticated;
GRANT ALL ON public.chat_messages TO service_role;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "chat read own or recipient" ON public.chat_messages FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR auth.uid() = recipient_id);
CREATE POLICY "chat insert own" ON public.chat_messages FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- 13. Profile auto-create trigger
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email,'@',1)),
    COALESCE((NEW.raw_user_meta_data->>'role')::public.app_role, 'patient')
  )
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, COALESCE((NEW.raw_user_meta_data->>'role')::public.app_role, 'patient'))
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 14. Revoke helper function access
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_caregiver_of(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_caregiver_of(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- 15. Realtime
ALTER TABLE public.sos_events REPLICA IDENTITY FULL;
ALTER TABLE public.devices REPLICA IDENTITY FULL;
ALTER TABLE public.medication_schedules REPLICA IDENTITY FULL;
ALTER TABLE public.chat_messages REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.sos_events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.devices;
ALTER PUBLICATION supabase_realtime ADD TABLE public.medication_schedules;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;

-- 16. Storage policies for firmware bucket
CREATE POLICY "firmware owner read"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'firmware'
  AND (
    auth.uid()::text = (storage.foldername(name))[1]
    OR EXISTS (
      SELECT 1 FROM public.caregiver_links cl
      WHERE cl.caregiver_id = auth.uid()
        AND cl.patient_id::text = (storage.foldername(name))[1]
    )
  )
);

CREATE POLICY "firmware owner write"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'firmware'
  AND (
    auth.uid()::text = (storage.foldername(name))[1]
    OR EXISTS (
      SELECT 1 FROM public.caregiver_links cl
      WHERE cl.caregiver_id = auth.uid()
        AND cl.patient_id::text = (storage.foldername(name))[1]
    )
  )
);

CREATE POLICY "firmware owner update"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'firmware'
  AND (
    auth.uid()::text = (storage.foldername(name))[1]
    OR EXISTS (
      SELECT 1 FROM public.caregiver_links cl
      WHERE cl.caregiver_id = auth.uid()
        AND cl.patient_id::text = (storage.foldername(name))[1]
    )
  )
);

CREATE POLICY "firmware owner delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'firmware'
  AND (
    auth.uid()::text = (storage.foldername(name))[1]
    OR EXISTS (
      SELECT 1 FROM public.caregiver_links cl
      WHERE cl.caregiver_id = auth.uid()
        AND cl.patient_id::text = (storage.foldername(name))[1]
    )
  )
);