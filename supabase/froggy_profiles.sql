create table if not exists froggy_profiles (
  id text primary key,
  color text,
  updated_at timestamptz default now()
);

alter table froggy_profiles enable row level security;

drop policy if exists "froggy_profiles read"   on froggy_profiles;
drop policy if exists "froggy_profiles write"  on froggy_profiles;
drop policy if exists "froggy_profiles update" on froggy_profiles;

create policy "froggy_profiles read"   on froggy_profiles for select using (true);
create policy "froggy_profiles write"  on froggy_profiles for insert with check (true);
create policy "froggy_profiles update" on froggy_profiles for update using (true);
