-- ============================================================================
-- 0004_transactions_ledger.sql
-- The core transaction ledger, household-scoped, with balance-consistent RPCs.
--
-- BALANCE SIGN CONVENTION (single source of truth: transaction_balance_delta):
--   income   → +amount_cents   (increases the account balance)
--   expense  → -amount_cents   (decreases the account balance)
--   transfer → -amount_cents   (outflow from account_id; the receiving leg is a
--                               separate row — v1 does not auto-create it)
--
-- SPLIT CONVENTION (no double counting):
--   A split's CHILD rows (split_parent_id IS NOT NULL) are categorization
--   breakdowns only and contribute 0 to balances. The PARENT row keeps the full
--   amount and the balance impact. Every balance calculation (the RPCs and
--   recompute_account_balance) only counts rows where split_parent_id IS NULL.
--   Children must sum exactly to the parent amount.
--
-- All balance mutations + the row write happen inside one RPC (one transaction)
-- so the stored balance and the ledger can never drift. RPCs run SECURITY
-- INVOKER, so the transactions/accounts RLS policies apply to their writes.
--
-- Safe to re-run.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Enums
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'transaction_type') then
    create type public.transaction_type as enum ('income', 'expense', 'transfer');
  end if;
  if not exists (select 1 from pg_type where typname = 'transaction_source') then
    create type public.transaction_source as enum ('manual', 'scanned', 'imported');
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- transactions
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.transactions (
  id                   uuid primary key default gen_random_uuid(),
  household_id         uuid not null references public.households (id) on delete cascade,
  account_id           uuid not null references public.accounts (id) on delete cascade,
  category_id          uuid references public.categories (id) on delete set null,
  type                 public.transaction_type not null,
  amount_cents         bigint not null check (amount_cents >= 0),
  currency             text not null default 'USD',
  description          text,
  merchant             text,
  date                 date not null,
  notes                text,
  pending              boolean not null default false,
  source               public.transaction_source not null default 'manual',
  receipt_url          text,
  plaid_transaction_id text,
  split_parent_id      uuid references public.transactions (id) on delete cascade,
  created_by           uuid references public.profiles (id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists transactions_household_id_idx on public.transactions (household_id);
create index if not exists transactions_account_id_idx   on public.transactions (account_id);
create index if not exists transactions_date_idx          on public.transactions (date);
create index if not exists transactions_category_id_idx   on public.transactions (category_id);
create index if not exists transactions_split_parent_idx  on public.transactions (split_parent_id);

-- Plaid dedup (Phase 3): unique when present, many NULLs allowed.
create unique index if not exists transactions_plaid_txn_uniq
  on public.transactions (plaid_transaction_id)
  where plaid_transaction_id is not null;

drop trigger if exists transactions_set_updated_at on public.transactions;
create trigger transactions_set_updated_at
  before update on public.transactions
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- Balance sign convention — the ONE place the math lives.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.transaction_balance_delta(
  p_type public.transaction_type,
  p_amount bigint
)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select case p_type::text
    when 'income'   then  p_amount
    when 'expense'  then -p_amount
    when 'transfer' then -p_amount
    else 0
  end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- recompute_account_balance — safety net. Recalculates a balance from the
-- ledger (parents/standalone only; children excluded) and stores it.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.recompute_account_balance(p_account_id uuid)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_balance bigint;
begin
  select coalesce(sum(public.transaction_balance_delta(t.type, t.amount_cents)), 0)
    into v_balance
    from public.transactions t
    where t.account_id = p_account_id
      and t.split_parent_id is null;

  update public.accounts
    set current_balance_cents = v_balance
    where id = p_account_id;

  return v_balance;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- create_transaction — insert row + apply balance delta atomically.
-- household_id/currency are DERIVED from the account (which RLS limits to the
-- caller's households), so a foreign account_id raises before any write.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.create_transaction(
  p_account_id      uuid,
  p_type            public.transaction_type,
  p_amount_cents    bigint,
  p_date            date,
  p_category_id     uuid default null,
  p_merchant        text default null,
  p_description     text default null,
  p_notes           text default null,
  p_pending         boolean default false,
  p_source          public.transaction_source default 'manual',
  p_split_parent_id uuid default null
)
returns public.transactions
language plpgsql
set search_path = ''
as $$
declare
  v_household uuid;
  v_currency  text;
  v_row       public.transactions;
begin
  select household_id, currency into v_household, v_currency
    from public.accounts where id = p_account_id;
  if v_household is null then
    raise exception 'Account not found' using errcode = 'no_data_found';
  end if;
  if p_category_id is not null
     and not exists (select 1 from public.categories where id = p_category_id) then
    raise exception 'Category not found' using errcode = 'no_data_found';
  end if;

  insert into public.transactions (
    household_id, account_id, category_id, type, amount_cents, currency, date,
    merchant, description, notes, pending, source, split_parent_id, created_by
  ) values (
    v_household, p_account_id, p_category_id, p_type, p_amount_cents, v_currency, p_date,
    p_merchant, p_description, p_notes, coalesce(p_pending, false), p_source,
    p_split_parent_id, auth.uid()
  )
  returning * into v_row;

  -- Children don't move money; the parent already accounted for it.
  if p_split_parent_id is null then
    update public.accounts
      set current_balance_cents =
        current_balance_cents + public.transaction_balance_delta(p_type, p_amount_cents)
      where id = p_account_id;
  end if;

  return v_row;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- update_transaction — reverse old contribution, write, apply new contribution.
-- Correct even when amount, type, or account changes.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.update_transaction(
  p_id           uuid,
  p_account_id   uuid,
  p_type         public.transaction_type,
  p_amount_cents bigint,
  p_date         date,
  p_category_id  uuid default null,
  p_merchant     text default null,
  p_description  text default null,
  p_notes        text default null,
  p_pending      boolean default false
)
returns public.transactions
language plpgsql
set search_path = ''
as $$
declare
  v_old       public.transactions;
  v_household uuid;
  v_currency  text;
  v_row       public.transactions;
begin
  select * into v_old from public.transactions where id = p_id;
  if v_old.id is null then
    raise exception 'Transaction not found' using errcode = 'no_data_found';
  end if;

  select household_id, currency into v_household, v_currency
    from public.accounts where id = p_account_id;
  if v_household is null then
    raise exception 'Account not found' using errcode = 'no_data_found';
  end if;
  if p_category_id is not null
     and not exists (select 1 from public.categories where id = p_category_id) then
    raise exception 'Category not found' using errcode = 'no_data_found';
  end if;

  -- Reverse the old contribution from the OLD account (non-child rows only).
  if v_old.split_parent_id is null then
    update public.accounts
      set current_balance_cents =
        current_balance_cents - public.transaction_balance_delta(v_old.type, v_old.amount_cents)
      where id = v_old.account_id;
  end if;

  update public.transactions set
    account_id   = p_account_id,
    household_id = v_household,
    category_id  = p_category_id,
    type         = p_type,
    amount_cents = p_amount_cents,
    currency     = v_currency,
    date         = p_date,
    merchant     = p_merchant,
    description  = p_description,
    notes        = p_notes,
    pending      = coalesce(p_pending, false)
  where id = p_id
  returning * into v_row;

  -- Apply the new contribution to the NEW account (non-child rows only).
  if v_old.split_parent_id is null then
    update public.accounts
      set current_balance_cents =
        current_balance_cents + public.transaction_balance_delta(p_type, p_amount_cents)
      where id = p_account_id;
  end if;

  return v_row;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- delete_transaction — reverse contribution + delete (children cascade).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.delete_transaction(p_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_row public.transactions;
begin
  select * into v_row from public.transactions where id = p_id;
  if v_row.id is null then
    raise exception 'Transaction not found' using errcode = 'no_data_found';
  end if;

  if v_row.split_parent_id is null then
    update public.accounts
      set current_balance_cents =
        current_balance_cents - public.transaction_balance_delta(v_row.type, v_row.amount_cents)
      where id = v_row.account_id;
  end if;

  -- Children (if any) cascade via the self-FK; they contributed 0 to balance.
  delete from public.transactions where id = p_id;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- split_transaction — replace the parent's children; validate exact sum.
-- No balance change: the parent still carries the full amount; children are 0.
-- p_children: jsonb array of { category_id?, amount_cents, description? }.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.split_transaction(
  p_parent_id uuid,
  p_children  jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_parent public.transactions;
  v_sum    bigint;
  v_child  jsonb;
begin
  select * into v_parent from public.transactions where id = p_parent_id;
  if v_parent.id is null then
    raise exception 'Transaction not found' using errcode = 'no_data_found';
  end if;
  if v_parent.split_parent_id is not null then
    raise exception 'Cannot split a split child' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(p_children) <> 'array' or jsonb_array_length(p_children) < 2 then
    raise exception 'A split needs at least two parts' using errcode = 'check_violation';
  end if;

  select coalesce(sum((c->>'amount_cents')::bigint), 0)
    into v_sum
    from jsonb_array_elements(p_children) c;

  if v_sum <> v_parent.amount_cents then
    raise exception 'Split parts must sum to the transaction total (% vs %)',
      v_sum, v_parent.amount_cents using errcode = 'check_violation';
  end if;

  -- Replace any existing children (balance unaffected — children are 0).
  delete from public.transactions where split_parent_id = p_parent_id;

  for v_child in select * from jsonb_array_elements(p_children) loop
    insert into public.transactions (
      household_id, account_id, category_id, type, amount_cents, currency, date,
      merchant, description, notes, pending, source, split_parent_id, created_by
    ) values (
      v_parent.household_id, v_parent.account_id,
      nullif(v_child->>'category_id', '')::uuid,
      v_parent.type,
      (v_child->>'amount_cents')::bigint,
      v_parent.currency, v_parent.date, v_parent.merchant,
      v_child->>'description', v_parent.notes, v_parent.pending, v_parent.source,
      p_parent_id, auth.uid()
    );
  end loop;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security — household-scoped, SELECT + write.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.transactions enable row level security;

drop policy if exists transactions_select_member on public.transactions;
create policy transactions_select_member on public.transactions
  for select using (household_id in (select public.current_user_household_ids()));

drop policy if exists transactions_insert_member on public.transactions;
create policy transactions_insert_member on public.transactions
  for insert with check (household_id in (select public.current_user_household_ids()));

drop policy if exists transactions_update_member on public.transactions;
create policy transactions_update_member on public.transactions
  for update using (household_id in (select public.current_user_household_ids()))
  with check (household_id in (select public.current_user_household_ids()));

drop policy if exists transactions_delete_member on public.transactions;
create policy transactions_delete_member on public.transactions
  for delete using (household_id in (select public.current_user_household_ids()));

-- ─────────────────────────────────────────────────────────────────────────────
-- Grants. DML is needed because the RPCs run SECURITY INVOKER (RLS still gates
-- every row). Functions are callable by signed-in users.
-- ─────────────────────────────────────────────────────────────────────────────
grant select, insert, update, delete on public.transactions to authenticated, service_role;

grant execute on function public.transaction_balance_delta(public.transaction_type, bigint) to authenticated, service_role;
grant execute on function public.recompute_account_balance(uuid) to authenticated, service_role;
grant execute on function public.create_transaction(uuid, public.transaction_type, bigint, date, uuid, text, text, text, boolean, public.transaction_source, uuid) to authenticated, service_role;
grant execute on function public.update_transaction(uuid, uuid, public.transaction_type, bigint, date, uuid, text, text, text, boolean) to authenticated, service_role;
grant execute on function public.delete_transaction(uuid) to authenticated, service_role;
grant execute on function public.split_transaction(uuid, jsonb) to authenticated, service_role;
