-- ============================================================================
-- 0002_profiles_household_read.sql
-- Let a household member read the profiles of their co-members.
--
-- Until now `profiles` was self-read-only, which forced getHouseholdMembers()
-- onto the service-role client to show a co-member's name/email. This adds a
-- household-scoped SELECT policy so co-member profiles are readable under normal
-- RLS. The existing self-read and self-update policies are kept unchanged.
--
-- `profiles` has no email column (email lives in auth.users), so we mirror it
-- into profiles — otherwise "name/email" can't be read under RLS without the
-- service client. Email is captured at account creation by handle_new_user.
--
-- Safe to re-run.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Mirror auth.users.email into profiles (RLS-readable identity)
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.profiles add column if not exists email text;

-- Backfill any existing rows.
update public.profiles p
set email = u.email
from auth.users u
where u.id = p.id
  and p.email is distinct from u.email;

-- Capture email on signup (extend the new-user trigger; otherwise unchanged).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, avatar_url, email)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name'
    ),
    new.raw_user_meta_data ->> 'avatar_url',
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Household-scoped SELECT policy on profiles
--    A profile row is readable when its owner is a member of a household the
--    caller also belongs to. Reuses the SECURITY DEFINER helper from 0001
--    (current_user_household_ids bypasses RLS → no recursion). This is ADDED
--    alongside the existing self policies (permissive SELECT policies OR together):
--      - profiles_select_own   (auth.uid() = id)        — kept
--      - profiles_update_own   (self update)            — kept
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists profiles_select_household_member on public.profiles;
create policy profiles_select_household_member on public.profiles
  for select using (
    id in (
      select hm.user_id
      from public.household_members hm
      where hm.household_id in (select public.current_user_household_ids())
    )
  );
