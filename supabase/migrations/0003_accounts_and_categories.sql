-- ============================================================================
-- 0003_accounts_and_categories.sql
-- accounts + categories (CLAUDE.md schema), with household-scoped RLS.
--
-- categories rows with household_id IS NULL are world-readable SYSTEM DEFAULTS,
-- seeded from src/lib/categories.ts. They are never user-writable. Custom
-- categories are household-scoped.
--
-- Money is integer cents (bigint). Safe to re-run.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Enums
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'account_type') then
    create type public.account_type as enum
      ('checking', 'savings', 'credit_card', 'cash', 'investment', 'loan');
  end if;
  if not exists (select 1 from pg_type where typname = 'category_kind') then
    create type public.category_kind as enum ('income', 'expense', 'transfer');
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- accounts
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.accounts (
  id                    uuid primary key default gen_random_uuid(),
  household_id          uuid not null references public.households (id) on delete cascade,
  name                  text not null,
  type                  public.account_type not null,
  institution           text,
  current_balance_cents bigint not null default 0,
  currency              text not null default 'USD',
  is_manual             boolean not null default true,
  is_archived           boolean not null default false,
  -- Plaid linkage (Phase 3). plaid_item_id's FK to plaid_items is added with
  -- that table later; the column exists now so the schema is stable.
  plaid_item_id         uuid,
  plaid_account_id      text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists accounts_household_id_idx
  on public.accounts (household_id);

drop trigger if exists accounts_set_updated_at on public.accounts;
create trigger accounts_set_updated_at
  before update on public.accounts
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- categories  (household_id NULL = system default)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.categories (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid references public.households (id) on delete cascade,
  name         text not null,
  kind         public.category_kind not null,
  parent_id    uuid references public.categories (id) on delete set null,
  icon         text,
  color        text,
  is_archived  boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists categories_household_id_idx
  on public.categories (household_id);

-- One system default per (name, kind) — also makes the seed below idempotent.
create unique index if not exists categories_system_default_uniq
  on public.categories (name, kind)
  where household_id is null;

drop trigger if exists categories_set_updated_at on public.categories;
create trigger categories_set_updated_at
  before update on public.categories
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed system-default categories (household_id = NULL) from src/lib/categories.ts
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.categories (household_id, name, kind, icon, color)
values
  -- income
  (null, 'Salary',              'income',   'Wallet',         '#0ea5e9'),
  (null, 'Freelance',           'income',   'Laptop',         '#6366f1'),
  (null, 'Interest & Dividends','income',   'PiggyBank',      '#14b8a6'),
  (null, 'Gifts',               'income',   'Gift',           '#a855f7'),
  (null, 'Refunds',             'income',   'RotateCcw',      '#8b5cf6'),
  (null, 'Other Income',        'income',   'Plus',           '#64748b'),
  -- expense
  (null, 'Groceries',           'expense',  'ShoppingCart',   '#f59e0b'),
  (null, 'Dining & Takeout',    'expense',  'Utensils',       '#fb923c'),
  (null, 'Housing & Rent',      'expense',  'Home',           '#0284c7'),
  (null, 'Utilities',           'expense',  'Zap',            '#eab308'),
  (null, 'Transportation',      'expense',  'Car',            '#3b82f6'),
  (null, 'Fuel',                'expense',  'Fuel',           '#f97316'),
  (null, 'Health & Medical',    'expense',  'HeartPulse',     '#ec4899'),
  (null, 'Insurance',           'expense',  'ShieldCheck',    '#0891b2'),
  (null, 'Entertainment',       'expense',  'Clapperboard',   '#d946ef'),
  (null, 'Shopping',            'expense',  'ShoppingBag',    '#f43f5e'),
  (null, 'Subscriptions',       'expense',  'Repeat',         '#8b5cf6'),
  (null, 'Travel',              'expense',  'Plane',          '#06b6d4'),
  (null, 'Education',           'expense',  'GraduationCap',  '#6366f1'),
  (null, 'Personal Care',       'expense',  'Sparkles',       '#e879f9'),
  (null, 'Gifts & Donations',   'expense',  'HandHeart',      '#a855f7'),
  (null, 'Kids & Family',       'expense',  'Baby',           '#fb7185'),
  (null, 'Pets',                'expense',  'PawPrint',       '#fbbf24'),
  (null, 'Fees & Charges',      'expense',  'Receipt',        '#94a3b8'),
  (null, 'Taxes',               'expense',  'Landmark',       '#475569'),
  (null, 'Debt Payment',        'expense',  'CreditCard',     '#7c3aed'),
  (null, 'Other Expense',       'expense',  'MoreHorizontal', '#64748b'),
  -- transfer
  (null, 'Transfer',            'transfer', 'ArrowLeftRight', '#64748b'),
  (null, 'Savings',             'transfer', 'PiggyBank',      '#10b981')
on conflict (name, kind) where household_id is null do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.accounts   enable row level security;
alter table public.categories enable row level security;

-- accounts: fully household-scoped (SELECT + write).
drop policy if exists accounts_select_member on public.accounts;
create policy accounts_select_member on public.accounts
  for select using (household_id in (select public.current_user_household_ids()));

drop policy if exists accounts_insert_member on public.accounts;
create policy accounts_insert_member on public.accounts
  for insert with check (household_id in (select public.current_user_household_ids()));

drop policy if exists accounts_update_member on public.accounts;
create policy accounts_update_member on public.accounts
  for update using (household_id in (select public.current_user_household_ids()))
  with check (household_id in (select public.current_user_household_ids()));

drop policy if exists accounts_delete_member on public.accounts;
create policy accounts_delete_member on public.accounts
  for delete using (household_id in (select public.current_user_household_ids()));

-- categories: system defaults (household_id IS NULL) are world-readable but
-- NOT user-writable; custom categories are household-scoped for read + write.
drop policy if exists categories_select_member_or_default on public.categories;
create policy categories_select_member_or_default on public.categories
  for select using (
    household_id is null
    or household_id in (select public.current_user_household_ids())
  );

-- Write policies require a non-null household_id owned by the caller, so a
-- household_id IS NULL (system-default) row can never be inserted, updated, or
-- deleted by a user.
drop policy if exists categories_insert_member on public.categories;
create policy categories_insert_member on public.categories
  for insert with check (household_id in (select public.current_user_household_ids()));

drop policy if exists categories_update_member on public.categories;
create policy categories_update_member on public.categories
  for update using (household_id in (select public.current_user_household_ids()))
  with check (household_id in (select public.current_user_household_ids()));

drop policy if exists categories_delete_member on public.categories;
create policy categories_delete_member on public.categories
  for delete using (household_id in (select public.current_user_household_ids()));

-- ─────────────────────────────────────────────────────────────────────────────
-- Grants (RLS still gates rows; service_role bypasses RLS for trusted use).
-- ─────────────────────────────────────────────────────────────────────────────
grant select, insert, update, delete
  on public.accounts, public.categories
  to authenticated, service_role;
