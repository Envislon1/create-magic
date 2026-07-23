
create type public.app_role as enum ('patient', 'caregiver', 'admin');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
create policy "profiles read all auth" on public.profiles for select to authenticated using (true);
create policy "profiles self update" on public.profiles for update to authenticated using (auth.uid() = id);
create policy "profiles self insert" on public.profiles for insert to authenticated with check (auth.uid() = id);

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;
create policy "roles self read" on public.user_roles for select to authenticated using (auth.uid() = user_id);

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', new.email));
  insert into public.user_roles (user_id, role)
  values (new.id, coalesce((new.raw_user_meta_data->>'role')::public.app_role, 'patient'));
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  pairing_code text not null unique,
  current_mode text default 'ANXIETY',
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.devices(user_id);
grant select, insert, update, delete on public.devices to authenticated;
grant all on public.devices to service_role;
alter table public.devices enable row level security;

create table public.caregiver_links (
  id uuid primary key default gen_random_uuid(),
  caregiver_id uuid not null references auth.users(id) on delete cascade,
  patient_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid references public.devices(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (caregiver_id, patient_id)
);
create index on public.caregiver_links(caregiver_id);
create index on public.caregiver_links(patient_id);
grant select, insert, update, delete on public.caregiver_links to authenticated;
grant all on public.caregiver_links to service_role;
alter table public.caregiver_links enable row level security;
create policy "links read participant" on public.caregiver_links for select to authenticated
  using (auth.uid() = caregiver_id or auth.uid() = patient_id);
create policy "links caregiver insert" on public.caregiver_links for insert to authenticated
  with check (auth.uid() = caregiver_id);
create policy "links participant delete" on public.caregiver_links for delete to authenticated
  using (auth.uid() = caregiver_id or auth.uid() = patient_id);

create policy "devices owner all" on public.devices for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "devices caregiver read" on public.devices for select to authenticated
  using (exists(select 1 from public.caregiver_links cl where cl.patient_id = devices.user_id and cl.caregiver_id = auth.uid()));

create table public.sos_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid references public.devices(id) on delete set null,
  source text not null default 'app',
  status text not null default 'active',
  note text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index on public.sos_events(user_id, created_at desc);
grant select, insert, update, delete on public.sos_events to authenticated;
grant all on public.sos_events to service_role;
alter table public.sos_events enable row level security;
create policy "sos owner all" on public.sos_events for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "sos caregiver read" on public.sos_events for select to authenticated
  using (exists(select 1 from public.caregiver_links cl where cl.patient_id = sos_events.user_id and cl.caregiver_id = auth.uid()));
create policy "sos caregiver update" on public.sos_events for update to authenticated
  using (exists(select 1 from public.caregiver_links cl where cl.patient_id = sos_events.user_id and cl.caregiver_id = auth.uid()));

create table public.medication_schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null default 'Medication',
  hour int not null default 20 check (hour between 0 and 23),
  minute int not null default 0 check (minute between 0 and 59),
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
create index on public.medication_schedules(user_id);
grant select, insert, update, delete on public.medication_schedules to authenticated;
grant all on public.medication_schedules to service_role;
alter table public.medication_schedules enable row level security;
create policy "meds owner all" on public.medication_schedules for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "meds caregiver read" on public.medication_schedules for select to authenticated
  using (exists(select 1 from public.caregiver_links cl where cl.patient_id = medication_schedules.user_id and cl.caregiver_id = auth.uid()));

create table public.mode_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null,
  created_at timestamptz not null default now()
);
create index on public.mode_history(user_id, created_at desc);
grant select, insert on public.mode_history to authenticated;
grant all on public.mode_history to service_role;
alter table public.mode_history enable row level security;
create policy "mode owner read" on public.mode_history for select to authenticated using (auth.uid() = user_id);
create policy "mode owner insert" on public.mode_history for insert to authenticated with check (auth.uid() = user_id);
create policy "mode caregiver read" on public.mode_history for select to authenticated
  using (exists(select 1 from public.caregiver_links cl where cl.patient_id = mode_history.user_id and cl.caregiver_id = auth.uid()));

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid references auth.users(id) on delete cascade,
  role text not null default 'user',
  content text not null,
  conversation text not null default 'guardian_ai',
  mode text,
  created_at timestamptz not null default now()
);
create index on public.chat_messages(user_id, created_at);
create index on public.chat_messages(recipient_id, created_at);
grant select, insert on public.chat_messages to authenticated;
grant all on public.chat_messages to service_role;
alter table public.chat_messages enable row level security;
create policy "chat read own or recipient" on public.chat_messages for select to authenticated
  using (auth.uid() = user_id or auth.uid() = recipient_id);
create policy "chat insert own" on public.chat_messages for insert to authenticated
  with check (auth.uid() = user_id);

alter table public.sos_events replica identity full;
alter table public.devices replica identity full;
alter table public.medication_schedules replica identity full;
alter table public.chat_messages replica identity full;
alter publication supabase_realtime add table public.sos_events;
alter publication supabase_realtime add table public.devices;
alter publication supabase_realtime add table public.medication_schedules;
alter publication supabase_realtime add table public.chat_messages;
