-- Allow a second admin email for the Music Library admin page.
-- Safe to re-run.
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
      and lower(email) in ('Koredefasanmade@gmail.com', 'wuf.device@gmail.com')
  )
$$;
grant execute on function public.is_admin(uuid) to authenticated, anon, service_role;
