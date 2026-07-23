
CREATE TABLE public.songs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  artist text NOT NULL,
  support_mode text NOT NULL DEFAULT 'general',
  storage_path text NOT NULL UNIQUE,
  duration_seconds int,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.songs TO authenticated;
GRANT ALL ON public.songs TO service_role;

ALTER TABLE public.songs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read songs"
  ON public.songs FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins manage songs"
  ON public.songs FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM auth.users u WHERE u.id = auth.uid()
      AND lower(u.email) IN ('wuf.tech@gmail.com','wuf.device@gmail.com'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM auth.users u WHERE u.id = auth.uid()
      AND lower(u.email) IN ('wuf.tech@gmail.com','wuf.device@gmail.com'))
  );

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER update_songs_updated_at
  BEFORE UPDATE ON public.songs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "Authenticated read music"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'music');

CREATE POLICY "Admins write music"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'music' AND EXISTS (
      SELECT 1 FROM auth.users u WHERE u.id = auth.uid()
        AND lower(u.email) IN ('wuf.tech@gmail.com','wuf.device@gmail.com'))
  );

CREATE POLICY "Admins update music"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'music' AND EXISTS (
      SELECT 1 FROM auth.users u WHERE u.id = auth.uid()
        AND lower(u.email) IN ('wuf.tech@gmail.com','wuf.device@gmail.com'))
  );

CREATE POLICY "Admins delete music"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'music' AND EXISTS (
      SELECT 1 FROM auth.users u WHERE u.id = auth.uid()
        AND lower(u.email) IN ('wuf.tech@gmail.com','wuf.device@gmail.com'))
  );
