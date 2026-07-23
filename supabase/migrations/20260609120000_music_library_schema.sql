-- Music library schema for admin uploads and device playback.
-- Uses support_mode instead of mode to avoid PostgreSQL's mode() ordered-set aggregate conflict.

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
      and lower(email) in ('wuf.tech@gmail.com', 'wuf.device@gmail.com')
  )
$$;
grant execute on function public.is_admin(uuid) to authenticated, anon, service_role;

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

alter table public.devices
  add column if not exists current_song_url text,
  add column if not exists current_song_at timestamptz;

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
