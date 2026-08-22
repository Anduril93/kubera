-- ============================================================================
-- 0001_identity_and_household.sql
-- Identity (profiles) + the shared Household model, with RLS.
--
-- Safe to re-run: guarded with IF NOT EXISTS / CREATE OR REPLACE / DROP ...
-- IF EXISTS throughout.
--
-- RLS non-recursion note: household_members policies must NOT query
-- household_members directly (that recurses). Instead they call SECURITY
-- DEFINER helper functions that read membership with RLS bypassed.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Enums
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'household_role') then
    create type public.household_role as enum ('owner', 'member');
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Shared: updated_at touch trigger
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- profiles (extends auth.users)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id                      uuid primary key references auth.users (id) on delete cascade,
  full_name               text,
  avatar_url              text,
  default_currency        text not null default 'USD',
  locale                  text not null default 'en-US',
  fiscal_month_start_day  int  not null default 1
                            check (fiscal_month_start_day between 1 and 28),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- households
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.households (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  owner_id     uuid not null references public.profiles (id) on delete cascade,
  invite_code  text not null unique,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

drop trigger if exists households_set_updated_at on public.households;
create trigger households_set_updated_at
  before update on public.households
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- household_members
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.household_members (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  role          public.household_role not null default 'member',
  joined_at     timestamptz not null default now(),
  unique (household_id, user_id)
);

create index if not exists household_members_user_id_idx
  on public.household_members (user_id);
create index if not exists household_members_household_id_idx
  on public.household_members (household_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- New-user trigger: create a profile row on signup
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name'
    ),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─────────────────────────────────────────────────────────────────────────────
-- Membership helper functions (SECURITY DEFINER → bypass RLS, avoid recursion).
-- Each is self-filtered to auth.uid(), so exposing them is safe.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.current_user_household_ids()
returns setof uuid
language sql
security definer
stable
set search_path = ''
as $$
  select household_id
  from public.household_members
  where user_id = auth.uid()
$$;

create or replace function public.current_user_owned_household_ids()
returns setof uuid
language sql
security definer
stable
set search_path = ''
as $$
  select id
  from public.households
  where owner_id = auth.uid()
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RPCs (SECURITY DEFINER). Identity is ALWAYS derived from auth.uid() — the
-- client never supplies an owner/user id.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.create_household_with_owner(
  p_name        text,
  p_invite_code text
)
returns public.households
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user      uuid := auth.uid();
  v_household public.households;
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'Household name is required' using errcode = '22023';
  end if;
  if coalesce(btrim(p_invite_code), '') = '' then
    raise exception 'Invite code is required' using errcode = '22023';
  end if;

  insert into public.households (name, owner_id, invite_code)
  values (btrim(p_name), v_user, btrim(p_invite_code))
  returning * into v_household;

  insert into public.household_members (household_id, user_id, role)
  values (v_household.id, v_user, 'owner');

  return v_household;
end;
$$;

create or replace function public.join_household_by_invite(
  p_invite_code text
)
returns public.households
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user      uuid := auth.uid();
  v_household public.households;
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_household
  from public.households
  where invite_code = btrim(p_invite_code);

  if v_household.id is null then
    raise exception 'Invalid invite code' using errcode = 'no_data_found';
  end if;

  insert into public.household_members (household_id, user_id, role)
  values (v_household.id, v_user, 'member')
  on conflict (household_id, user_id) do nothing;

  return v_household;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.profiles          enable row level security;
alter table public.households         enable row level security;
alter table public.household_members  enable row level security;

-- profiles: a user may read/update only their own row. (No INSERT policy: the
-- handle_new_user trigger creates rows as definer. No DELETE: cascades with the
-- auth user.)
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select using (auth.uid() = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- households: readable by members; only the owner may update/delete.
-- (No INSERT policy: creation goes through create_household_with_owner.)
drop policy if exists households_select_member on public.households;
create policy households_select_member on public.households
  for select using (id in (select public.current_user_household_ids()));

drop policy if exists households_update_owner on public.households;
create policy households_update_owner on public.households
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists households_delete_owner on public.households;
create policy households_delete_owner on public.households
  for delete using (owner_id = auth.uid());

-- household_members: readable by members of the same household; only the
-- household owner may manage membership directly. (Self-join goes through
-- join_household_by_invite, which runs as definer.)
drop policy if exists household_members_select_member on public.household_members;
create policy household_members_select_member on public.household_members
  for select using (household_id in (select public.current_user_household_ids()));

drop policy if exists household_members_insert_owner on public.household_members;
create policy household_members_insert_owner on public.household_members
  for insert with check (household_id in (select public.current_user_owned_household_ids()));

drop policy if exists household_members_update_owner on public.household_members;
create policy household_members_update_owner on public.household_members
  for update using (household_id in (select public.current_user_owned_household_ids()))
  with check (household_id in (select public.current_user_owned_household_ids()));

drop policy if exists household_members_delete_owner on public.household_members;
create policy household_members_delete_owner on public.household_members
  for delete using (household_id in (select public.current_user_owned_household_ids()));

-- ─────────────────────────────────────────────────────────────────────────────
-- Grants. RLS gates row visibility; these grant the table/function privileges
-- the API roles need. service_role bypasses RLS for trusted server use.
-- ─────────────────────────────────────────────────────────────────────────────
grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete
  on public.profiles, public.households, public.household_members
  to authenticated, service_role;

-- Helper functions are used inside policies → authenticated must execute them.
grant execute on function public.current_user_household_ids() to authenticated, service_role;
grant execute on function public.current_user_owned_household_ids() to authenticated, service_role;

-- RPCs: callable only by signed-in users (never anon).
revoke all on function public.create_household_with_owner(text, text) from public;
revoke all on function public.join_household_by_invite(text) from public;
grant execute on function public.create_household_with_owner(text, text) to authenticated;
grant execute on function public.join_household_by_invite(text) to authenticated;
