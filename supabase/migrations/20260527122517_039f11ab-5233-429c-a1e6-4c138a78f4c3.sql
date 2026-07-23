
-- 1. Roles on profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'patient' CHECK (role IN ('patient','caregiver'));

-- 2. Caregiver <-> Patient link table
CREATE TABLE IF NOT EXISTS public.caregiver_links (
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

CREATE POLICY "caregiver or patient can view link"
  ON public.caregiver_links FOR SELECT TO authenticated
  USING (auth.uid() = caregiver_id OR auth.uid() = patient_id);

CREATE POLICY "caregiver creates link"
  ON public.caregiver_links FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = caregiver_id);

CREATE POLICY "either party deletes link"
  ON public.caregiver_links FOR DELETE TO authenticated
  USING (auth.uid() = caregiver_id OR auth.uid() = patient_id);

-- 3. Extend chat_messages for care conversations
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS conversation text NOT NULL DEFAULT 'guardian_ai';
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS recipient_id uuid;
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS read_at timestamptz;

-- Drop old restrictive policy and add new ones
DROP POLICY IF EXISTS "own chats" ON public.chat_messages;

CREATE POLICY "view own or care chats"
  ON public.chat_messages FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id
    OR auth.uid() = recipient_id
  );

CREATE POLICY "insert own chats"
  ON public.chat_messages FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "update own chat read state"
  ON public.chat_messages FOR UPDATE TO authenticated
  USING (auth.uid() = recipient_id OR auth.uid() = user_id);

-- 4. Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.devices;
ALTER PUBLICATION supabase_realtime ADD TABLE public.medication_schedules;

-- 5. Trigger to populate profile role from signup metadata
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
