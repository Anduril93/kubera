-- ============================================================================
-- 0009_debts.sql
-- Debt tracking. Two balance modes (same discipline as savings goals):
--   linked_account_id set  → balance comes from that (liability) account
--   linked_account_id null → balance is the manually-maintained principal_cents
--
-- NOTE ON NET WORTH: debts are NOT added to the net-worth computation. Net worth
-- is derived from accounts only (see computeNetPosition, 1.6). A linked debt just
-- points at an account already counted as a liability, and a manual debt is a
-- standalone record — so debts never double-count into net worth.
--
-- APR is a PERCENTAGE (e.g. 18.99), stored as numeric(5,2) — never cents.
--
-- Safe to re-run.
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'debt_type') then
    create type public.debt_type as enum
      ('credit_card', 'student_loan', 'mortgage', 'auto', 'personal', 'other');
  end if;
end $$;

create table if not exists public.debts (
  id                    uuid primary key default gen_random_uuid(),
  household_id          uuid not null references public.households (id) on delete cascade,
  name                  text not null,
  type                  public.debt_type not null,
  principal_cents       bigint not null default 0 check (principal_cents >= 0),
  apr                   numeric(5, 2) check (apr >= 0 and apr <= 100),
  minimum_payment_cents bigint check (minimum_payment_cents >= 0),
  due_day               int check (due_day >= 1 and due_day <= 31),
  linked_account_id     uuid references public.accounts (id) on delete set null,
  -- Plaid Liabilities linkage (Phase 3): text id, no FK yet.
  plaid_account_id      text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists debts_household_id_idx on public.debts (household_id);
create index if not exists debts_linked_account_idx on public.debts (linked_account_id);

drop trigger if exists debts_set_updated_at on public.debts;
create trigger debts_set_updated_at
  before update on public.debts
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security — household-scoped, SELECT + write.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.debts enable row level security;

drop policy if exists debts_select_member on public.debts;
create policy debts_select_member on public.debts
  for select using (household_id in (select public.current_user_household_ids()));

drop policy if exists debts_insert_member on public.debts;
create policy debts_insert_member on public.debts
  for insert with check (household_id in (select public.current_user_household_ids()));

drop policy if exists debts_update_member on public.debts;
create policy debts_update_member on public.debts
  for update using (household_id in (select public.current_user_household_ids()))
  with check (household_id in (select public.current_user_household_ids()));

drop policy if exists debts_delete_member on public.debts;
create policy debts_delete_member on public.debts
  for delete using (household_id in (select public.current_user_household_ids()));

grant select, insert, update, delete on public.debts to authenticated, service_role;
