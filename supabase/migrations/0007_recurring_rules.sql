-- ============================================================================
-- 0007_recurring_rules.sql
-- Recurring bills & income. Posting a due instance creates a transaction via
-- the 1.6 create_transaction RPC (never direct DML, so balance-keeping holds),
-- then advances next_due_date — atomically and idempotently.
--
-- NOTE: auto_post is stored but there is NO cron/scheduled job yet — posting is
-- user-triggered in the UI. Scheduled auto-posting of due `auto_post` rules
-- comes later (it would call post_recurring_rule for each due rule).
--
-- Safe to re-run.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Enum (type reuses transaction_type, constrained to income/expense below)
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'recurring_frequency') then
    create type public.recurring_frequency as enum
      ('weekly', 'biweekly', 'monthly', 'quarterly', 'yearly');
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- recurring_rules
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.recurring_rules (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  account_id    uuid not null references public.accounts (id) on delete cascade,
  category_id   uuid references public.categories (id) on delete set null,
  name          text not null,
  amount_cents  bigint not null check (amount_cents >= 0),
  -- recurring rules are only income or expense (no transfer).
  type          public.transaction_type not null check (type in ('income', 'expense')),
  frequency     public.recurring_frequency not null,
  next_due_date date not null,
  end_date      date,
  auto_post     boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists recurring_rules_household_id_idx on public.recurring_rules (household_id);
create index if not exists recurring_rules_account_id_idx on public.recurring_rules (account_id);
create index if not exists recurring_rules_next_due_date_idx on public.recurring_rules (next_due_date);

drop trigger if exists recurring_rules_set_updated_at on public.recurring_rules;
create trigger recurring_rules_set_updated_at
  before update on public.recurring_rules
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- advance_recurring_date — advance a date by one interval. Month/quarter/year
-- use interval arithmetic, which clamps month-end (Jan 31 + 1 month → Feb 28/29,
-- never an invalid date).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.advance_recurring_date(
  p_date date,
  p_freq public.recurring_frequency
)
returns date
language sql
immutable
set search_path = ''
as $$
  select case p_freq::text
    when 'weekly'    then p_date + 7
    when 'biweekly'  then p_date + 14
    when 'monthly'   then (p_date + interval '1 month')::date
    when 'quarterly' then (p_date + interval '3 months')::date
    when 'yearly'    then (p_date + interval '1 year')::date
    else p_date
  end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- post_recurring_rule — create the transaction for the current due instance and
-- advance next_due_date, atomically. Returns the new transaction id, or NULL if
-- the rule is not currently due (idempotent no-op).
--
-- The row is locked FOR UPDATE so concurrent posts serialize; combined with the
-- "only if due" guard + advance, the same instance can never post twice.
-- SECURITY INVOKER: transactions/accounts/recurring RLS all apply.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.post_recurring_rule(p_id uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_rule public.recurring_rules;
  v_txn  public.transactions;
begin
  select * into v_rule from public.recurring_rules where id = p_id for update;
  if v_rule.id is null then
    raise exception 'Recurring rule not found' using errcode = 'no_data_found';
  end if;

  -- Not due yet → nothing to post (makes a repeat/double-click a no-op).
  if v_rule.next_due_date > current_date then
    return null;
  end if;
  -- Past its end_date → the rule has finished.
  if v_rule.end_date is not null and v_rule.next_due_date > v_rule.end_date then
    return null;
  end if;

  -- Create the transaction through the balance-consistent RPC (same
  -- transaction → the insert, balance update, and advance are all atomic).
  v_txn := public.create_transaction(
    v_rule.account_id,
    v_rule.type,
    v_rule.amount_cents,
    v_rule.next_due_date,
    v_rule.category_id,
    v_rule.name,                              -- merchant
    null,                                     -- description
    null,                                     -- notes
    false,                                    -- pending
    'manual'::public.transaction_source
  );

  update public.recurring_rules
    set next_due_date = public.advance_recurring_date(v_rule.next_due_date, v_rule.frequency)
    where id = p_id;

  return v_txn.id;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security — household-scoped, SELECT + write.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.recurring_rules enable row level security;

drop policy if exists recurring_rules_select_member on public.recurring_rules;
create policy recurring_rules_select_member on public.recurring_rules
  for select using (household_id in (select public.current_user_household_ids()));

drop policy if exists recurring_rules_insert_member on public.recurring_rules;
create policy recurring_rules_insert_member on public.recurring_rules
  for insert with check (household_id in (select public.current_user_household_ids()));

drop policy if exists recurring_rules_update_member on public.recurring_rules;
create policy recurring_rules_update_member on public.recurring_rules
  for update using (household_id in (select public.current_user_household_ids()))
  with check (household_id in (select public.current_user_household_ids()));

drop policy if exists recurring_rules_delete_member on public.recurring_rules;
create policy recurring_rules_delete_member on public.recurring_rules
  for delete using (household_id in (select public.current_user_household_ids()));

-- ─────────────────────────────────────────────────────────────────────────────
-- Grants
-- ─────────────────────────────────────────────────────────────────────────────
grant select, insert, update, delete on public.recurring_rules to authenticated, service_role;
grant execute on function public.advance_recurring_date(date, public.recurring_frequency) to authenticated, service_role;
grant execute on function public.post_recurring_rule(uuid) to authenticated, service_role;
