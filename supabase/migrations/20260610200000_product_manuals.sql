-- Product manuals: a single "active" PDF (or other doc) shown on the landing
-- page for download. Admin uploads new versions; the latest active row wins.

CREATE TABLE IF NOT EXISTS public.product_manuals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_url     text NOT NULL,
  file_name    text NOT NULL,
  storage_path text,
  version      text,
  size_bytes   bigint,
  uploaded_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_manuals_active_idx
  ON public.product_manuals (is_active, created_at DESC);

GRANT SELECT ON public.product_manuals TO anon, authenticated;
GRANT ALL    ON public.product_manuals TO service_role;

ALTER TABLE public.product_manuals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read active manuals" ON public.product_manuals;
CREATE POLICY "Anyone can read active manuals"
  ON public.product_manuals
  FOR SELECT
  TO anon, authenticated
  USING (is_active = true);

INSERT INTO storage.buckets (id, name, public)
VALUES ('manuals', 'manuals', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

DROP POLICY IF EXISTS "Public can read manuals" ON storage.objects;
CREATE POLICY "Public can read manuals"
  ON storage.objects
  FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'manuals');

INSERT INTO public.product_manuals (file_url, file_name, version, is_active)
SELECT '/mind-buddy-manual.pdf', 'mind-buddy-manual.pdf', '1.0', true
WHERE NOT EXISTS (SELECT 1 FROM public.product_manuals);
