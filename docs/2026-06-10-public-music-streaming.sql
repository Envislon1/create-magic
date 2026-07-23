-- Allow anonymous (publishable-key) clients to read the songs catalogue and
-- stream from the music bucket. Needed because the local server / firmware
-- only have the publishable key (Lovable Cloud manages the service role).
--
-- Run this in the Supabase SQL editor. Idempotent.

-- 1. Songs: allow anon SELECT
grant select on public.songs to anon;

drop policy if exists "songs readable by anon" on public.songs;
create policy "songs readable by anon"
  on public.songs for select to anon using (true);

-- 2. Storage: make the music bucket public so signed URLs aren't required
update storage.buckets set public = true where id = 'music';

drop policy if exists "music: read for anon" on storage.objects;
create policy "music: read for anon"
  on storage.objects for select to anon
  using (bucket_id = 'music');
