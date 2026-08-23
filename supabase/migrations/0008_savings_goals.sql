-- ============================================================================
-- 0008_savings_goals.sql
-- Savings goals with two progress modes:
--   linked_account_id set  → progress tracks that account's current_balance_cents
--   linked_account_id null → progress uses the manual current_amount_cents
--
-- Manual contributions go through contribute_to_goal(), which refuses to touch
-- a linked goal (the account balance is the source of truth there).
--
-- Safe to re-run.
-- ============================================================================

create table if not exists public.savings_goals (
  id                   uuid primary key default gen_random_uuid(),
  household_id         uuid not null references public.households (id) on delete cascade,
  name                 text not null,
  target_amount_cents  bigint not null check (target_amount_cents >= 0),
  target_date          date,
  linked_account_id    uuid references public.accounts (id) on delete set null,
  current_amount_cents bigint not null default 0 check (current_amount_cents >= 0),
  color                text,
  icon                 text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists savings_goals_household_id_idx on public.savings_goals (household_id);
create index if not exists savings_goals_linked_account_idx on public.savings_goals (linked_account_id);

drop trigger if exists savings_goals_set_updated_at on public.savings_goals;
create trigger savings_goals_set_updated_at
  before update on public.savings_goals
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- contribute_to_goal — atomically adjust a MANUAL goal's current amount (clamped
-- at 0). Returns the new amount, or NULL when the goal doesn't exist or is
-- linked (the `linked_account_id is null` guard rejects linked goals). Positive
-- delta adds, negative withdraws. SECURITY INVOKER, so RLS applies.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.contribute_to_goal(p_id uuid, p_delta bigint)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_new bigint;
begin
  update public.savings_goals
    set current_amount_cents = greatest(0, current_amount_cents + p_delta)
    where id = p_id and linked_account_id is null
    returning current_amount_cents into v_new;
  return v_new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security — household-scoped, SELECT + write.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.savings_goals enable row level security;

drop policy if exists savings_goals_select_member on public.savings_goals;
create policy savings_goals_select_member on public.savings_goals
  for select using (household_id in (select public.current_user_household_ids()));

drop policy if exists savings_goals_insert_member on public.savings_goals;
create policy savings_goals_insert_member on public.savings_goals
  for insert with check (household_id in (select public.current_user_household_ids()));

drop policy if exists savings_goals_update_member on public.savings_goals;
create policy savings_goals_update_member on public.savings_goals
  for update using (household_id in (select public.current_user_household_ids()))
  with check (household_id in (select public.current_user_household_ids()));

drop policy if exists savings_goals_delete_member on public.savings_goals;
create policy savings_goals_delete_member on public.savings_goals
  for delete using (household_id in (select public.current_user_household_ids()));

-- ─────────────────────────────────────────────────────────────────────────────
-- Grants
-- ─────────────────────────────────────────────────────────────────────────────
grant select, insert, update, delete on public.savings_goals to authenticated, service_role;
grant execute on function public.contribute_to_goal(uuid, bigint) to authenticated, service_role;
