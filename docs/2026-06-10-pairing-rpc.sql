-- Pairing-code lookup for caregivers (run in Supabase SQL editor).
-- Safe to re-run. Provides a SECURITY DEFINER RPC so caregivers can resolve
-- a patient's pairing code without needing direct SELECT on `devices`.

-- 1. Make sure grants & RLS on devices allow the patient to insert/select
--    their own row (this is what produces the pairing code in the first place).
grant select, insert, update on public.devices to authenticated;
grant all on public.devices to service_role;
alter table public.devices enable row level security;

drop policy if exists "devices: owner selects" on public.devices;
create policy "devices: owner selects" on public.devices
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "devices: owner inserts" on public.devices;
create policy "devices: owner inserts" on public.devices
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "devices: owner updates" on public.devices;
create policy "devices: owner updates" on public.devices
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "devices: linked caregiver selects" on public.devices;
create policy "devices: linked caregiver selects" on public.devices
  for select to authenticated
  using (exists (
    select 1 from public.caregiver_links
    where caregiver_id = auth.uid() and patient_id = devices.user_id
  ));

-- 2. caregiver_links grants + uniqueness
grant select, insert, delete on public.caregiver_links to authenticated;
grant all on public.caregiver_links to service_role;
alter table public.caregiver_links enable row level security;

do $$ begin
  alter table public.caregiver_links
    add constraint caregiver_links_unique unique (caregiver_id, patient_id);
exception when duplicate_table or duplicate_object then null; end $$;

drop policy if exists "links: caregiver manages own" on public.caregiver_links;
create policy "links: caregiver manages own" on public.caregiver_links
  for all to authenticated
  using (caregiver_id = auth.uid())
  with check (caregiver_id = auth.uid());

-- 3. The actual fix: SECURITY DEFINER lookup the caregiver can call.
create or replace function public.find_device_by_pairing_code(_code text)
returns table (id uuid, user_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select d.id, d.user_id
  from public.devices d
  where regexp_replace(upper(trim(d.pairing_code)), '\s+', '', 'g') = regexp_replace(upper(trim(_code)), '\s+', '', 'g')
  limit 1;
$$;
grant execute on function public.find_device_by_pairing_code(text) to authenticated;
