-- ============================================================================
-- 0006_budgets.sql
-- Per-category budgets. "Spent" is NEVER stored — it is derived from the ledger
-- for the budget's current period via category_period_spend().
--
-- Spend counting rule (the INVERSE of the balance rule, same as the dashboard's
-- spending-by-category): count split CHILDREN and CHILDLESS parents, exclude any
-- parent that has children, expenses only (no income, no transfers). A $100
-- expense split $60 Groceries + $40 Household contributes $60 to Groceries and
-- $40 to Household — never $100 to the parent's category.
--
-- Period ranges are computed in the data layer (reusing 1.8's fiscalMonthRange
-- for monthly, respecting fiscal_month_start_day; Mon–Sun for weekly) and passed
-- to category_period_spend as an explicit [start, end) date range.
--
-- Safe to re-run.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Enum
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'budget_period') then
    create type public.budget_period as enum ('weekly', 'monthly');
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- budgets
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.budgets (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  category_id  uuid not null references public.categories (id) on delete cascade,
  period       public.budget_period not null,
  amount_cents bigint not null check (amount_cents >= 0),
  rollover     boolean not null default false,
  start_date   date not null default current_date,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- A household can't have two budgets for the same category + period.
  unique (household_id, category_id, period)
);

create index if not exists budgets_household_id_idx on public.budgets (household_id);
create index if not exists budgets_category_id_idx on public.budgets (category_id);

drop trigger if exists budgets_set_updated_at on public.budgets;
create trigger budgets_set_updated_at
  before update on public.budgets
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- category_period_spend — derived spend for one category over [start, end).
-- SECURITY INVOKER, so transactions RLS scopes the sum to the caller's
-- household automatically. Applies the spend counting rule described above.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.category_period_spend(
  p_category_id uuid,
  p_start date,
  p_end date
)
returns bigint
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(t.amount_cents), 0)
  from public.transactions t
  where t.type = 'expense'
    and t.category_id = p_category_id
    and t.date >= p_start
    and t.date < p_end
    and (
      -- a split child (carries the real category breakdown) ...
      t.split_parent_id is not null
      -- ... or a childless parent/standalone row; parents WITH children excluded.
      or not exists (
        select 1 from public.transactions c where c.split_parent_id = t.id
      )
    );
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security — household-scoped, SELECT + write.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.budgets enable row level security;

drop policy if exists budgets_select_member on public.budgets;
create policy budgets_select_member on public.budgets
  for select using (household_id in (select public.current_user_household_ids()));

drop policy if exists budgets_insert_member on public.budgets;
create policy budgets_insert_member on public.budgets
  for insert with check (household_id in (select public.current_user_household_ids()));

drop policy if exists budgets_update_member on public.budgets;
create policy budgets_update_member on public.budgets
  for update using (household_id in (select public.current_user_household_ids()))
  with check (household_id in (select public.current_user_household_ids()));

drop policy if exists budgets_delete_member on public.budgets;
create policy budgets_delete_member on public.budgets
  for delete using (household_id in (select public.current_user_household_ids()));

-- ─────────────────────────────────────────────────────────────────────────────
-- Grants
-- ─────────────────────────────────────────────────────────────────────────────
grant select, insert, update, delete on public.budgets to authenticated, service_role;
grant execute on function public.category_period_spend(uuid, date, date) to authenticated, service_role;
