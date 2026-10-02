-- ============================================================================
-- 0013_plaid_bank_sync.sql
-- Plaid bank sync + reconciliation.
--
-- Model:
--   * A linked account (accounts.is_manual = false) takes its balance from the
--     bank. Ledger writes never move a linked account's balance, so the app
--     can't drift from the bank.
--   * Bank transactions arrive through plaid_apply_sync (service role only,
--     called by the plaid / plaid-webhook Edge Functions). A bank transaction
--     that matches something the household already entered (same account,
--     same amount and direction, date within -5/+3 days) is MERGED into that
--     entry — category, notes, receipt and splits are kept — instead of
--     creating a duplicate. Everything bank-originated lands in review
--     (review_state = 'needs_review') until the household confirms it.
--   * Pending → posted replaces the pending row in place; deleting a bank
--     transaction remembers its id so later syncs never re-import it.
--   * Access tokens live in Supabase Vault; plaid_items keeps only the secret
--     id, and clients can't even select that column.
--
-- Safe to re-run.
-- ============================================================================

create extension if not exists supabase_vault with schema vault;

-- ─────────────────────────────────────────────────────────────────────────────
-- plaid_items (one row per connected bank login)
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'plaid_item_status') then
    create type public.plaid_item_status as enum ('active', 'login_required', 'error');
  end if;
end $$;

create table if not exists public.plaid_items (
  id               uuid primary key default gen_random_uuid(),
  household_id     uuid not null references public.households (id) on delete cascade,
  created_by       uuid references public.profiles (id) on delete set null,
  item_id          text not null unique,
  institution_id   text,
  institution_name text,
  status           public.plaid_item_status not null default 'active',
  error_code       text,
  cursor           text,
  access_token_ref uuid,
  last_synced_at   timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists plaid_items_household_id_idx on public.plaid_items (household_id);

drop trigger if exists plaid_items_set_updated_at on public.plaid_items;
create trigger plaid_items_set_updated_at
  before update on public.plaid_items
  for each row execute function public.set_updated_at();

alter table public.plaid_items enable row level security;

drop policy if exists plaid_items_select_member on public.plaid_items;
create policy plaid_items_select_member on public.plaid_items
  for select using (household_id in (select public.current_user_household_ids()));

-- Writes happen only through the service role (Edge Functions). Clients may
-- read status columns but never the vault reference or the sync cursor.
revoke all on public.plaid_items from anon, authenticated;
grant select (id, household_id, created_by, item_id, institution_id, institution_name,
              status, error_code, last_synced_at, created_at, updated_at)
  on public.plaid_items to authenticated;
grant all on public.plaid_items to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- accounts: link to plaid_items, bank balance metadata
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.accounts add column if not exists mask text;
alter table public.accounts add column if not exists available_balance_cents bigint;
alter table public.accounts add column if not exists bank_balance_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'accounts_plaid_item_id_fkey'
  ) then
    alter table public.accounts
      add constraint accounts_plaid_item_id_fkey
      foreign key (plaid_item_id) references public.plaid_items (id) on delete set null;
  end if;
end $$;

create unique index if not exists accounts_plaid_account_uniq
  on public.accounts (plaid_item_id, plaid_account_id)
  where plaid_item_id is not null;

-- Clients can't link/unlink accounts or overwrite a bank-reported balance.
create or replace function public.guard_linked_account()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'authenticated' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if not new.is_manual or new.plaid_item_id is not null or new.plaid_account_id is not null then
      raise exception 'Linked accounts are created by bank sync' using errcode = '42501';
    end if;
  elsif new.is_manual is distinct from old.is_manual
     or new.plaid_item_id is distinct from old.plaid_item_id
     or new.plaid_account_id is distinct from old.plaid_account_id
     or (not old.is_manual and new.current_balance_cents is distinct from old.current_balance_cents) then
    raise exception 'Linked account balances come from the bank' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists accounts_guard_linked on public.accounts;
create trigger accounts_guard_linked
  before insert or update on public.accounts
  for each row execute function public.guard_linked_account();

-- ─────────────────────────────────────────────────────────────────────────────
-- transactions: review + match state
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.transactions add column if not exists review_state text;
alter table public.transactions add column if not exists match_state text;
alter table public.transactions add column if not exists bank_snapshot jsonb;

alter table public.transactions drop constraint if exists transactions_review_state_check;
alter table public.transactions
  add constraint transactions_review_state_check
  check (review_state is null or review_state in ('needs_review', 'reviewed'));

alter table public.transactions drop constraint if exists transactions_match_state_check;
alter table public.transactions
  add constraint transactions_match_state_check
  check (match_state is null or match_state in ('auto', 'manual'));

create index if not exists transactions_needs_review_idx
  on public.transactions (household_id)
  where review_state = 'needs_review';

-- Bank transactions the household deleted ("ignore") — never re-imported.
create table if not exists public.plaid_ignored_transactions (
  plaid_transaction_id text primary key,
  household_id         uuid not null references public.households (id) on delete cascade,
  ignored_at           timestamptz not null default now()
);

alter table public.plaid_ignored_transactions enable row level security;
drop policy if exists plaid_ignored_select_member on public.plaid_ignored_transactions;
create policy plaid_ignored_select_member on public.plaid_ignored_transactions
  for select using (household_id in (select public.current_user_household_ids()));
revoke all on public.plaid_ignored_transactions from anon, authenticated;
grant select on public.plaid_ignored_transactions to authenticated;
grant all on public.plaid_ignored_transactions to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Ledger RPCs (from 0011): linked accounts keep the bank's balance, and
-- deleting a bank transaction remembers it.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.create_transaction(
  p_account_id   uuid,
  p_type         public.transaction_type,
  p_amount_cents bigint,
  p_date         date,
  p_category_id  uuid default null,
  p_merchant     text default null,
  p_description  text default null,
  p_notes        text default null,
  p_pending      boolean default false,
  p_source       public.transaction_source default 'manual',
  p_receipt_url  text default null
)
returns public.transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household uuid;
  v_currency  text;
  v_row       public.transactions;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select household_id, currency into v_household, v_currency
    from public.accounts where id = p_account_id;
  if v_household is null or not public.is_household_member(v_household) then
    raise exception 'Account not found' using errcode = 'no_data_found';
  end if;
  if p_amount_cents is null or p_amount_cents < 0 then
    raise exception 'Amount must not be negative' using errcode = '22023';
  end if;
  if p_date is null then
    raise exception 'Date is required' using errcode = '22023';
  end if;
  if p_source = 'imported' then
    raise exception 'Imported transactions come from bank sync only' using errcode = '42501';
  end if;

  insert into public.transactions (
    household_id, account_id, category_id, type, amount_cents, currency, date,
    merchant, description, notes, pending, source, receipt_url, created_by
  ) values (
    v_household, p_account_id, p_category_id, p_type, p_amount_cents, v_currency, p_date,
    nullif(btrim(p_merchant), ''), nullif(btrim(p_description), ''), nullif(btrim(p_notes), ''),
    coalesce(p_pending, false), coalesce(p_source, 'manual'),
    nullif(btrim(p_receipt_url), ''), auth.uid()
  )
  returning * into v_row;

  update public.accounts
    set current_balance_cents =
      current_balance_cents + public.transaction_balance_delta(p_type, p_amount_cents)
    where id = p_account_id and is_manual;

  return v_row;
end;
$$;

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
security definer
set search_path = ''
as $$
declare
  v_old       public.transactions;
  v_household uuid;
  v_currency  text;
  v_row       public.transactions;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_old from public.transactions where id = p_id for update;
  if v_old.id is null or not public.is_household_member(v_old.household_id) then
    raise exception 'Transaction not found' using errcode = 'no_data_found';
  end if;
  if v_old.split_parent_id is not null then
    raise exception 'Edit split parts from the parent transaction' using errcode = '22023';
  end if;
  if p_amount_cents is null or p_amount_cents < 0 then
    raise exception 'Amount must not be negative' using errcode = '22023';
  end if;

  select household_id, currency into v_household, v_currency
    from public.accounts where id = p_account_id;
  if v_household is null or v_household <> v_old.household_id then
    raise exception 'Account not found' using errcode = 'no_data_found';
  end if;

  update public.accounts
    set current_balance_cents =
      current_balance_cents - public.transaction_balance_delta(v_old.type, v_old.amount_cents)
    where id = v_old.account_id and is_manual;

  update public.transactions set
    account_id   = p_account_id,
    category_id  = p_category_id,
    type         = p_type,
    amount_cents = p_amount_cents,
    currency     = v_currency,
    date         = p_date,
    merchant     = nullif(btrim(p_merchant), ''),
    description  = nullif(btrim(p_description), ''),
    notes        = nullif(btrim(p_notes), ''),
    pending      = coalesce(p_pending, false)
  where id = p_id
  returning * into v_row;

  update public.accounts
    set current_balance_cents =
      current_balance_cents + public.transaction_balance_delta(p_type, p_amount_cents)
    where id = p_account_id and is_manual;

  if p_amount_cents <> v_old.amount_cents then
    delete from public.transactions where split_parent_id = p_id;
  else
    update public.transactions set
      account_id = v_row.account_id,
      type       = v_row.type,
      currency   = v_row.currency,
      date       = v_row.date,
      merchant   = v_row.merchant,
      notes      = v_row.notes,
      pending    = v_row.pending
    where split_parent_id = p_id;
  end if;

  return v_row;
end;
$$;

create or replace function public.delete_transaction(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.transactions;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_row from public.transactions where id = p_id for update;
  if v_row.id is null or not public.is_household_member(v_row.household_id) then
    raise exception 'Transaction not found' using errcode = 'no_data_found';
  end if;
  if v_row.split_parent_id is not null then
    raise exception 'Edit split parts from the parent transaction' using errcode = '22023';
  end if;

  update public.accounts
    set current_balance_cents =
      current_balance_cents - public.transaction_balance_delta(v_row.type, v_row.amount_cents)
    where id = v_row.account_id and is_manual;

  if v_row.plaid_transaction_id is not null then
    insert into public.plaid_ignored_transactions (plaid_transaction_id, household_id)
    values (v_row.plaid_transaction_id, v_row.household_id)
    on conflict (plaid_transaction_id) do nothing;
  end if;

  delete from public.transactions where id = p_id;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Review / reconcile RPCs (signed-in members)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.mark_transactions_reviewed(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  update public.transactions
    set review_state = 'reviewed'
    where id = any (p_ids)
      and review_state = 'needs_review'
      and household_id in (select public.current_user_household_ids());
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Category-only edit (the review inbox's quick categorize). Also reviews it.
create or replace function public.set_transaction_category(p_id uuid, p_category_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.transactions;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  select * into v_row from public.transactions where id = p_id for update;
  if v_row.id is null or not public.is_household_member(v_row.household_id) then
    raise exception 'Transaction not found' using errcode = 'no_data_found';
  end if;
  update public.transactions
    set category_id  = p_category_id,
        review_state = case when review_state is null then null else 'reviewed' end
    where id = p_id;
end;
$$;

-- Merge a bank transaction into an entry the household made themselves. The
-- entry keeps its category/notes/receipt; the bank's amount and date win.
create or replace function public.match_bank_transaction(p_bank_id uuid, p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bank  public.transactions;
  v_entry public.transactions;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_bank from public.transactions where id = p_bank_id for update;
  select * into v_entry from public.transactions where id = p_entry_id for update;
  if v_bank.id is null or v_entry.id is null
     or not public.is_household_member(v_bank.household_id)
     or v_entry.household_id <> v_bank.household_id then
    raise exception 'Transaction not found' using errcode = 'no_data_found';
  end if;
  if v_bank.source <> 'imported' or v_bank.plaid_transaction_id is null or v_bank.match_state is not null then
    raise exception 'Pick a bank transaction to match' using errcode = '22023';
  end if;
  if v_entry.plaid_transaction_id is not null or v_entry.split_parent_id is not null then
    raise exception 'That entry is already matched' using errcode = '22023';
  end if;
  if v_entry.account_id <> v_bank.account_id then
    raise exception 'Both transactions must be on the same account' using errcode = '22023';
  end if;

  -- Free the unique plaid id first, then move it onto the entry.
  delete from public.transactions where id = v_bank.id;

  if v_entry.amount_cents <> v_bank.amount_cents then
    delete from public.transactions where split_parent_id = v_entry.id;
  end if;

  update public.transactions set
    plaid_transaction_id = v_bank.plaid_transaction_id,
    amount_cents         = v_bank.amount_cents,
    date                 = v_bank.date,
    pending              = v_bank.pending,
    bank_snapshot        = v_bank.bank_snapshot,
    match_state          = 'manual',
    review_state         = 'reviewed'
  where id = v_entry.id;

  update public.transactions set date = v_bank.date, pending = v_bank.pending
    where split_parent_id = v_entry.id;
end;
$$;

-- Undo a match: the entry goes back to being the household's own record and
-- the bank transaction reappears in review as its own row.
create or replace function public.unmatch_transaction(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row  public.transactions;
  v_snap jsonb;
  v_new  uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  select * into v_row from public.transactions where id = p_id for update;
  if v_row.id is null or not public.is_household_member(v_row.household_id) then
    raise exception 'Transaction not found' using errcode = 'no_data_found';
  end if;
  if v_row.match_state is null or v_row.plaid_transaction_id is null then
    raise exception 'This transaction is not matched' using errcode = '22023';
  end if;
  v_snap := coalesce(v_row.bank_snapshot, '{}'::jsonb);

  update public.transactions set
    plaid_transaction_id = null,
    bank_snapshot        = null,
    match_state          = null,
    review_state         = null,
    pending              = false
  where id = v_row.id;

  insert into public.transactions (
    household_id, account_id, category_id, type, amount_cents, currency, date,
    merchant, pending, source, plaid_transaction_id, bank_snapshot, review_state
  ) values (
    v_row.household_id, v_row.account_id, null, v_row.type,
    coalesce((v_snap->>'amount_cents')::bigint, v_row.amount_cents), v_row.currency,
    coalesce((v_snap->>'date')::date, v_row.date),
    coalesce(v_snap->>'merchant', v_row.merchant),
    coalesce((v_snap->>'pending')::boolean, false), 'imported',
    v_row.plaid_transaction_id, v_snap, 'needs_review'
  )
  returning id into v_new;
  return v_new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Service-role sync machinery (called only from Edge Functions)
-- ─────────────────────────────────────────────────────────────────────────────

-- Plaid personal_finance_category → our system category name.
create or replace function public.plaid_category_name(p_detailed text, p_primary text, p_inflow boolean)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_primary = 'TRANSFER_IN' then 'Transfer'
    when p_detailed = 'TRANSFER_OUT_SAVINGS' then 'Savings'
    when p_primary = 'TRANSFER_OUT' then 'Transfer'
    when p_detailed = 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT' then 'Transfer'
    when p_inflow and p_primary = 'INCOME' then case
      when p_detailed = 'INCOME_WAGES' then 'Salary'
      when p_detailed in ('INCOME_DIVIDENDS', 'INCOME_INTEREST_EARNED') then 'Interest & Dividends'
      else 'Other Income' end
    when p_inflow then 'Refunds'
    when p_primary = 'LOAN_PAYMENTS' then 'Debt Payment'
    when p_primary = 'BANK_FEES' then 'Fees & Charges'
    when p_primary = 'ENTERTAINMENT' then 'Entertainment'
    when p_detailed = 'FOOD_AND_DRINK_GROCERIES' then 'Groceries'
    when p_primary = 'FOOD_AND_DRINK' then 'Dining & Takeout'
    when p_primary = 'GENERAL_MERCHANDISE' then 'Shopping'
    when p_primary = 'HOME_IMPROVEMENT' then 'Housing & Rent'
    when p_primary = 'MEDICAL' then 'Health & Medical'
    when p_primary = 'PERSONAL_CARE' then 'Personal Care'
    when p_detailed = 'GENERAL_SERVICES_INSURANCE' then 'Insurance'
    when p_detailed = 'GENERAL_SERVICES_EDUCATION' then 'Education'
    when p_detailed = 'GENERAL_SERVICES_CHILDCARE' then 'Kids & Family'
    when p_detailed = 'GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT' then 'Taxes'
    when p_detailed = 'GOVERNMENT_AND_NON_PROFIT_DONATIONS' then 'Gifts & Donations'
    when p_detailed = 'TRANSPORTATION_GAS' then 'Fuel'
    when p_primary = 'TRANSPORTATION' then 'Transportation'
    when p_primary = 'TRAVEL' then 'Travel'
    when p_detailed = 'RENT_AND_UTILITIES_RENT' then 'Housing & Rent'
    when p_primary = 'RENT_AND_UTILITIES' then 'Utilities'
    else 'Other Expense'
  end;
$$;

-- Vault wrappers. The raw token only ever exists inside these functions and
-- the Edge Function's memory.
create or replace function public.plaid_store_access_token(p_item_id text, p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  return vault.create_secret(p_token, 'plaid_access_token_' || p_item_id, 'Plaid access token');
end;
$$;

create or replace function public.plaid_get_access_token(p_item uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.decrypted_secret
  from public.plaid_items i
  join vault.decrypted_secrets s on s.id = i.access_token_ref
  where i.id = p_item;
$$;

create or replace function public.plaid_delete_access_token(p_ref uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from vault.secrets where id = p_ref;
$$;

-- Creates the item and one linked account per Plaid account.
create or replace function public.plaid_register_item(
  p_household_id     uuid,
  p_user_id          uuid,
  p_item_id          text,
  p_token_ref        uuid,
  p_institution_id   text,
  p_institution_name text,
  p_accounts         jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item uuid;
  v_acct jsonb;
  v_type public.account_type;
  v_bal  jsonb;
begin
  insert into public.plaid_items (household_id, created_by, item_id, institution_id, institution_name, access_token_ref)
  values (p_household_id, p_user_id, p_item_id, p_institution_id, p_institution_name, p_token_ref)
  on conflict (item_id) do update set
    access_token_ref = excluded.access_token_ref,
    status = 'active', error_code = null
  returning id into v_item;

  for v_acct in select * from jsonb_array_elements(coalesce(p_accounts, '[]'::jsonb)) loop
    v_type := case
      when v_acct->>'type' = 'credit' then 'credit_card'
      when v_acct->>'type' = 'loan' then 'loan'
      when v_acct->>'type' = 'investment' then 'investment'
      when v_acct->>'subtype' in ('savings', 'money market', 'cd', 'hsa') then 'savings'
      else 'checking'
    end::public.account_type;
    v_bal := v_acct->'balances';

    insert into public.accounts (
      household_id, name, type, institution, currency, is_manual,
      plaid_item_id, plaid_account_id, mask,
      current_balance_cents, available_balance_cents, bank_balance_at
    ) values (
      p_household_id,
      coalesce(nullif(v_acct->>'name', ''), v_acct->>'official_name', 'Account'),
      v_type, p_institution_name,
      coalesce(v_bal->>'iso_currency_code', 'USD'), false,
      v_item, v_acct->>'account_id', v_acct->>'mask',
      round(coalesce((v_bal->>'current')::numeric, (v_bal->>'available')::numeric, 0) * 100)::bigint,
      round((v_bal->>'available')::numeric * 100)::bigint,
      now()
    )
    on conflict (plaid_item_id, plaid_account_id) where plaid_item_id is not null do nothing;
  end loop;

  return v_item;
end;
$$;

-- Applies one /transactions/sync result atomically. Order matters: added and
-- modified before removed, so a pending → posted pair updates in place.
create or replace function public.plaid_apply_sync(
  p_item        uuid,
  p_added       jsonb,
  p_modified    jsonb,
  p_removed     jsonb,
  p_accounts    jsonb,
  p_next_cursor text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item     public.plaid_items;
  v_acct     public.accounts;
  v_t        jsonb;
  v_bal      jsonb;
  v_cents    bigint;
  v_inflow   boolean;
  v_type     public.transaction_type;
  v_date     date;
  v_merchant text;
  v_cat      uuid;
  v_snap     jsonb;
  v_existing public.transactions;
  v_match    uuid;
  v_added    integer := 0;
  v_matched  integer := 0;
  v_modified integer := 0;
  v_removed  integer := 0;
begin
  select * into v_item from public.plaid_items where id = p_item for update;
  if v_item.id is null then
    raise exception 'Unknown item' using errcode = 'no_data_found';
  end if;

  -- Balances (the bank is the source of truth for linked accounts).
  for v_t in select * from jsonb_array_elements(coalesce(p_accounts, '[]'::jsonb)) loop
    v_bal := v_t->'balances';
    update public.accounts set
      current_balance_cents = round(coalesce((v_bal->>'current')::numeric, (v_bal->>'available')::numeric, 0) * 100)::bigint,
      available_balance_cents = round((v_bal->>'available')::numeric * 100)::bigint,
      bank_balance_at = now()
    where plaid_item_id = v_item.id and plaid_account_id = v_t->>'account_id';
  end loop;

  -- Added + modified share one upsert path.
  for v_t in
    select value from jsonb_array_elements(coalesce(p_added, '[]'::jsonb))
    union all
    select value from jsonb_array_elements(coalesce(p_modified, '[]'::jsonb))
  loop
    select * into v_acct from public.accounts
      where plaid_item_id = v_item.id and plaid_account_id = v_t->>'account_id';
    continue when v_acct.id is null;
    continue when exists (
      select 1 from public.plaid_ignored_transactions where plaid_transaction_id = v_t->>'transaction_id'
    );

    -- Plaid: positive = money out of the account, negative = money in.
    v_inflow   := (v_t->>'amount')::numeric < 0;
    v_cents    := round(abs((v_t->>'amount')::numeric) * 100)::bigint;
    v_date     := (v_t->>'date')::date;
    v_merchant := left(coalesce(nullif(v_t->>'merchant_name', ''), v_t->>'name'), 120);
    v_type := case
      when v_inflow then 'income'
      when v_t->'personal_finance_category'->>'primary' = 'TRANSFER_OUT'
        or v_t->'personal_finance_category'->>'detailed' = 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT' then 'transfer'
      else 'expense'
    end::public.transaction_type;
    v_snap := jsonb_build_object(
      'name', v_t->>'name',
      'merchant', v_merchant,
      'amount_cents', v_cents,
      'date', v_date,
      'pending', (v_t->>'pending')::boolean,
      'category', v_t->'personal_finance_category'->>'detailed'
    );

    -- Existing row: same id, or the pending row this posted transaction replaces.
    select * into v_existing from public.transactions
      where plaid_transaction_id in (v_t->>'transaction_id', v_t->>'pending_transaction_id')
      order by (plaid_transaction_id = v_t->>'transaction_id') desc
      limit 1
      for update;

    if v_existing.id is not null then
      update public.transactions set
        plaid_transaction_id = v_t->>'transaction_id',
        pending       = (v_t->>'pending')::boolean,
        date          = v_date,
        amount_cents  = case
          when exists (select 1 from public.transactions c where c.split_parent_id = v_existing.id)
            then amount_cents else v_cents end,
        merchant      = case when match_state is null then v_merchant else merchant end,
        bank_snapshot = v_snap
      where id = v_existing.id;
      update public.transactions set date = v_date, pending = (v_t->>'pending')::boolean
        where split_parent_id = v_existing.id;
      v_modified := v_modified + 1;
      continue;
    end if;

    -- Something the household already entered for this?
    select c.id into v_match from public.transactions c
      where c.account_id = v_acct.id
        and c.split_parent_id is null
        and c.plaid_transaction_id is null
        and c.source in ('manual', 'scanned')
        and (c.type = 'income') = v_inflow
        and c.amount_cents = v_cents
        and c.date between v_date - 5 and v_date + 3
      order by abs(c.date - v_date), c.created_at
      limit 1
      for update;

    if v_match is not null then
      update public.transactions set
        plaid_transaction_id = v_t->>'transaction_id',
        pending       = (v_t->>'pending')::boolean,
        bank_snapshot = v_snap,
        match_state   = 'auto',
        review_state  = 'needs_review'
      where id = v_match;
      v_matched := v_matched + 1;
      continue;
    end if;

    select id into v_cat from public.categories
      where household_id is null
        and name = public.plaid_category_name(
          v_t->'personal_finance_category'->>'detailed',
          v_t->'personal_finance_category'->>'primary',
          v_inflow)
      limit 1;

    insert into public.transactions (
      household_id, account_id, category_id, type, amount_cents, currency, date,
      merchant, pending, source, plaid_transaction_id, bank_snapshot, review_state
    ) values (
      v_item.household_id, v_acct.id, v_cat, v_type, v_cents,
      coalesce(v_t->>'iso_currency_code', v_acct.currency), v_date,
      v_merchant, (v_t->>'pending')::boolean, 'imported',
      v_t->>'transaction_id', v_snap, 'needs_review'
    );
    v_added := v_added + 1;
  end loop;

  -- Removed: pure imports go away; matched entries revert to the household's
  -- own record.
  for v_t in select * from jsonb_array_elements(coalesce(p_removed, '[]'::jsonb)) loop
    delete from public.transactions
      where household_id = v_item.household_id
        and plaid_transaction_id = v_t->>'transaction_id'
        and match_state is null;
    update public.transactions set
      plaid_transaction_id = null, bank_snapshot = null, match_state = null, review_state = null
      where household_id = v_item.household_id
        and plaid_transaction_id = v_t->>'transaction_id';
    v_removed := v_removed + 1;
  end loop;

  update public.plaid_items set
    cursor = coalesce(p_next_cursor, cursor),
    last_synced_at = now(),
    status = 'active',
    error_code = null
  where id = v_item.id;

  return jsonb_build_object(
    'added', v_added, 'matched', v_matched, 'modified', v_modified, 'removed', v_removed
  );
end;
$$;

create or replace function public.plaid_set_item_status(p_item uuid, p_status public.plaid_item_status, p_error_code text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.plaid_items set status = p_status, error_code = p_error_code where id = p_item;
$$;

-- Disconnect: accounts stay (with their history) as manual accounts.
create or replace function public.plaid_unlink_item(p_item uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref uuid;
begin
  select access_token_ref into v_ref from public.plaid_items where id = p_item;
  update public.accounts set is_manual = true, plaid_item_id = null, plaid_account_id = null
    where plaid_item_id = p_item;
  delete from public.plaid_items where id = p_item;
  return v_ref;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Privileges
-- ─────────────────────────────────────────────────────────────────────────────
revoke all on function public.guard_linked_account() from public, anon, authenticated;
revoke all on function public.plaid_category_name(text, text, boolean) from public, anon, authenticated;
revoke all on function public.plaid_store_access_token(text, text) from public, anon, authenticated;
revoke all on function public.plaid_get_access_token(uuid) from public, anon, authenticated;
revoke all on function public.plaid_delete_access_token(uuid) from public, anon, authenticated;
revoke all on function public.plaid_register_item(uuid, uuid, text, uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.plaid_apply_sync(uuid, jsonb, jsonb, jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public.plaid_set_item_status(uuid, public.plaid_item_status, text) from public, anon, authenticated;
revoke all on function public.plaid_unlink_item(uuid) from public, anon, authenticated;

grant execute on function public.plaid_category_name(text, text, boolean) to service_role;
grant execute on function public.plaid_store_access_token(text, text) to service_role;
grant execute on function public.plaid_get_access_token(uuid) to service_role;
grant execute on function public.plaid_delete_access_token(uuid) to service_role;
grant execute on function public.plaid_register_item(uuid, uuid, text, uuid, text, text, jsonb) to service_role;
grant execute on function public.plaid_apply_sync(uuid, jsonb, jsonb, jsonb, jsonb, text) to service_role;
grant execute on function public.plaid_set_item_status(uuid, public.plaid_item_status, text) to service_role;
grant execute on function public.plaid_unlink_item(uuid) to service_role;

revoke all on function public.mark_transactions_reviewed(uuid[]) from public, anon;
revoke all on function public.set_transaction_category(uuid, uuid) from public, anon;
revoke all on function public.match_bank_transaction(uuid, uuid) from public, anon;
revoke all on function public.unmatch_transaction(uuid) from public, anon;
grant execute on function public.mark_transactions_reviewed(uuid[]) to authenticated;
grant execute on function public.set_transaction_category(uuid, uuid) to authenticated;
grant execute on function public.match_bank_transaction(uuid, uuid) to authenticated;
grant execute on function public.unmatch_transaction(uuid) to authenticated;
