-- Music library, admin role, and mood tracking
-- =============================================
-- Run this in the Supabase SQL editor (Project → SQL → New query).
-- It is idempotent; re-running is safe.

-- 1. is_admin() helper (wuf.tech@gmail.com is the sole admin)
create or replace function public.is_admin(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from auth.users
    where id = _user_id
      and lower(email) = 'wuf.tech@gmail.com'
  )
$$;
grant execute on function public.is_admin(uuid) to authenticated, anon, service_role;

-- 2. songs table
create table if not exists public.songs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  artist text not null default 'Unknown',
  support_mode text not null default 'general',
  storage_path text not null,
  duration_seconds int,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
grant select on public.songs to authenticated;
grant all on public.songs to service_role;
alter table public.songs
  add column if not exists support_mode text not null default 'general',
  add column if not exists storage_path text,
  add column if not exists duration_seconds int,
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists created_at timestamptz not null default now();
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'songs' and column_name = 'mode'
  ) then
    execute 'update public.songs set support_mode = coalesce(nullif("mode", ''''), ''general'') where support_mode = ''general''';
  end if;
end $$;
alter table public.songs enable row level security;

drop policy if exists "songs readable by authenticated" on public.songs;
create policy "songs readable by authenticated"
  on public.songs for select to authenticated using (true);

drop policy if exists "songs writable by admin" on public.songs;
create policy "songs writable by admin"
  on public.songs for all to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- 3. current_song columns on devices
alter table public.devices
  add column if not exists current_song_url text,
  add column if not exists current_song_at timestamptz;

-- 4. mood_entries (rolling cap = last 20 per patient)
create table if not exists public.mood_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  score int not null check (score between 1 and 5),
  note text,
  created_at timestamptz not null default now()
);
create index if not exists mood_entries_user_created_idx
  on public.mood_entries (user_id, created_at desc);
grant select, insert on public.mood_entries to authenticated;
grant all on public.mood_entries to service_role;
alter table public.mood_entries enable row level security;

drop policy if exists "mood: patient inserts own" on public.mood_entries;
create policy "mood: patient inserts own"
  on public.mood_entries for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "mood: patient reads own" on public.mood_entries;
create policy "mood: patient reads own"
  on public.mood_entries for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "mood: caregiver reads linked" on public.mood_entries;
create policy "mood: caregiver reads linked"
  on public.mood_entries for select to authenticated
  using (exists (
    select 1 from public.caregiver_links
    where caregiver_id = auth.uid() and patient_id = mood_entries.user_id
  ));

create or replace function public.trim_mood_entries()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.mood_entries
  where user_id = new.user_id
    and id not in (
      select id from public.mood_entries
      where user_id = new.user_id
      order by created_at desc
      limit 20
    );
  return new;
end;
$$;

drop trigger if exists mood_entries_trim on public.mood_entries;
create trigger mood_entries_trim
  after insert on public.mood_entries
  for each row execute function public.trim_mood_entries();

-- 5. Storage bucket "music" + policies
insert into storage.buckets (id, name, public)
values ('music', 'music', false)
on conflict (id) do nothing;

drop policy if exists "music: read for authenticated" on storage.objects;
create policy "music: read for authenticated"
  on storage.objects for select to authenticated
  using (bucket_id = 'music');

drop policy if exists "music: admin writes" on storage.objects;
create policy "music: admin writes"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'music' and public.is_admin(auth.uid()));

drop policy if exists "music: admin updates" on storage.objects;
create policy "music: admin updates"
  on storage.objects for update to authenticated
  using (bucket_id = 'music' and public.is_admin(auth.uid()))
  with check (bucket_id = 'music' and public.is_admin(auth.uid()));

drop policy if exists "music: admin deletes" on storage.objects;
create policy "music: admin deletes"
  on storage.objects for delete to authenticated
  using (bucket_id = 'music' and public.is_admin(auth.uid()));
