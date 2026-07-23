CREATE TABLE IF NOT EXISTS public.songs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  artist text,
  mood text,
  storage_path text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.songs TO authenticated;
GRANT SELECT ON public.songs TO anon;
GRANT ALL ON public.songs TO service_role;

ALTER TABLE public.songs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Songs are readable by everyone"
  ON public.songs FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can insert songs"
  ON public.songs FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update songs"
  ON public.songs FOR UPDATE
  TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can delete songs"
  ON public.songs FOR DELETE
  TO authenticated
  USING (true);