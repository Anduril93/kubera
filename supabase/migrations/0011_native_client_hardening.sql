-- ============================================================================
-- 0011_native_client_hardening.sql
-- The iOS app talks to Supabase directly with the user's JWT — there are no
-- Next.js server actions in between — so every invariant those actions used to
-- guard must now hold in the database itself. This migration:
--
--   1. Routes ALL ledger writes through SECURITY DEFINER RPCs with explicit
--      membership checks. Direct INSERT/DELETE on transactions is revoked and
--      direct UPDATE is limited to receipt_url (the web app still sets it).
--   2. Rejects cross-household references (FK checks bypass RLS, so any UUID
--      used to be accepted) and moving rows between households.
--   3. Validates receipt keys, split structure (one level, same account, parts
--      > 0, children follow their parent), and goal contributions.
--   4. Locks down membership (join only via the invite RPC, one household per
--      user), invite-code format, and profile email (synced from auth only).
--   5. Scopes category_period_spend to the caller's household.
--   6. Revokes function EXECUTE from PUBLIC/anon (Supabase grants it by default).
--
-- Web-app compatibility: every RPC keeps its existing named parameters (new
-- ones are optional), so the Next.js app keeps working until it is retired.
--
-- Safe to re-run.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Membership + reference helpers (SECURITY DEFINER so they see past RLS and
-- give an accurate answer; never granted to clients)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.is_household_member(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.household_members
    where household_id = p_household_id and user_id = auth.uid()
  );
$$;

create or replace function public.assert_account_in_household(p_account_id uuid, p_household_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_account_id is null then
    return;
  end if;
  if not exists (
    select 1 from public.accounts where id = p_account_id and household_id = p_household_id
  ) then
    raise exception 'Account not found in this household' using errcode = '23503';
  end if;
end;
$$;

-- A usable category is a system default (household_id null) or one of the
-- household's own. p_kind, when given, must match the category's kind.
create or replace function public.assert_category_usable(
  p_category_id  uuid,
  p_household_id uuid,
  p_kind         public.category_kind default null
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_category_id is null then
    return;
  end if;
  if not exists (
    select 1 from public.categories c
    where c.id = p_category_id
      and (c.household_id is null or c.household_id = p_household_id)
      and (p_kind is null or c.kind = p_kind)
  ) then
    raise exception 'Category not available' using errcode = '23503';
  end if;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Reference-integrity triggers (one per table; all reject household moves)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.reject_household_move()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.household_id is distinct from old.household_id then
    raise exception 'Rows cannot move between households' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.check_transaction_refs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent public.transactions;
begin
  perform public.assert_account_in_household(new.account_id, new.household_id);
  perform public.assert_category_usable(new.category_id, new.household_id);

  if new.split_parent_id is not null then
    select * into v_parent from public.transactions where id = new.split_parent_id;
    if v_parent.id is null
       or v_parent.household_id <> new.household_id
       or v_parent.account_id <> new.account_id
       or v_parent.split_parent_id is not null then
      raise exception 'Invalid split parent' using errcode = '23503';
    end if;
  end if;

  -- Receipt keys are private object paths: receipts/<household_id>/<name>.<ext>
  if new.receipt_url is not null
     and new.receipt_url !~ ('^receipts/' || new.household_id::text || '/[A-Za-z0-9_-]+\.(jpg|png|webp|pdf)$') then
    raise exception 'Invalid receipt reference' using errcode = '22023';
  end if;

  return new;
end;
$$;

create or replace function public.check_category_refs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent public.categories;
begin
  if new.parent_id is not null then
    select * into v_parent from public.categories where id = new.parent_id;
    -- One level of nesting only (which also rules out cycles), same kind,
    -- parent is a system default or the same household's.
    if v_parent.id is null
       or v_parent.id = new.id
       or v_parent.parent_id is not null
       or v_parent.kind <> new.kind
       or (v_parent.household_id is not null and v_parent.household_id is distinct from new.household_id) then
      raise exception 'Invalid parent category' using errcode = '23503';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.check_budget_refs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_category_usable(new.category_id, new.household_id, 'expense');
  return new;
end;
$$;

create or replace function public.check_recurring_refs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_account_in_household(new.account_id, new.household_id);
  perform public.assert_category_usable(new.category_id, new.household_id);
  if new.end_date is not null and new.end_date < new.next_due_date then
    raise exception 'End date is before the next due date' using errcode = '22023';
  end if;
  return new;
end;
$$;

create or replace function public.check_linked_account_ref()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_account_in_household(new.linked_account_id, new.household_id);
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'accounts', 'categories', 'transactions', 'budgets',
    'recurring_rules', 'savings_goals', 'debts'
  ] loop
    execute format('drop trigger if exists %I on public.%I', t || '_reject_household_move', t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.reject_household_move()',
      t || '_reject_household_move', t
    );
  end loop;
end $$;

drop trigger if exists transactions_check_refs on public.transactions;
create trigger transactions_check_refs
  before insert or update on public.transactions
  for each row execute function public.check_transaction_refs();

drop trigger if exists categories_check_refs on public.categories;
create trigger categories_check_refs
  before insert or update on public.categories
  for each row execute function public.check_category_refs();

drop trigger if exists budgets_check_refs on public.budgets;
create trigger budgets_check_refs
  before insert or update on public.budgets
  for each row execute function public.check_budget_refs();

drop trigger if exists recurring_rules_check_refs on public.recurring_rules;
create trigger recurring_rules_check_refs
  before insert or update on public.recurring_rules
  for each row execute function public.check_recurring_refs();

drop trigger if exists savings_goals_check_refs on public.savings_goals;
create trigger savings_goals_check_refs
  before insert or update on public.savings_goals
  for each row execute function public.check_linked_account_ref();

drop trigger if exists debts_check_refs on public.debts;
create trigger debts_check_refs
  before insert or update on public.debts
  for each row execute function public.check_linked_account_ref();

-- ─────────────────────────────────────────────────────────────────────────────
-- Ledger RPCs → SECURITY DEFINER with explicit membership checks
-- ─────────────────────────────────────────────────────────────────────────────

-- create_transaction: p_split_parent_id is gone (splits go through
-- split_transaction only); p_receipt_url is new so the receipt is attached in
-- the same statement instead of a follow-up UPDATE.
drop function if exists public.create_transaction(
  uuid, public.transaction_type, bigint, date, uuid, text, text, text, boolean,
  public.transaction_source, uuid
);

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
    where id = p_account_id;

  return v_row;
end;
$$;

-- update_transaction: same signature as 0004. Children now follow their
-- parent; changing a split parent's amount removes the split (the parts would
-- no longer sum), and children can't be edited directly.
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

  -- Reverse the old contribution from the OLD account.
  update public.accounts
    set current_balance_cents =
      current_balance_cents - public.transaction_balance_delta(v_old.type, v_old.amount_cents)
    where id = v_old.account_id;

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

  -- Apply the new contribution to the NEW account.
  update public.accounts
    set current_balance_cents =
      current_balance_cents + public.transaction_balance_delta(p_type, p_amount_cents)
    where id = p_account_id;

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
    where id = v_row.account_id;

  -- Children cascade via the self-FK; they contributed 0 to the balance.
  delete from public.transactions where id = p_id;
end;
$$;

create or replace function public.split_transaction(p_parent_id uuid, p_children jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent public.transactions;
  v_sum    bigint;
  v_child  jsonb;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_parent from public.transactions where id = p_parent_id for update;
  if v_parent.id is null or not public.is_household_member(v_parent.household_id) then
    raise exception 'Transaction not found' using errcode = 'no_data_found';
  end if;
  if v_parent.split_parent_id is not null then
    raise exception 'Cannot split a split child' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(p_children) is distinct from 'array' or jsonb_array_length(p_children) < 2 then
    raise exception 'A split needs at least two parts' using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_children) c
    where coalesce((c->>'amount_cents')::bigint, 0) <= 0
  ) then
    raise exception 'Each part must be greater than zero' using errcode = 'check_violation';
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
      nullif(btrim(v_child->>'description'), ''), v_parent.notes, v_parent.pending, v_parent.source,
      p_parent_id, auth.uid()
    );
  end loop;
end;
$$;

-- post_recurring_rule: now SECURITY DEFINER, calls the new create_transaction
-- by name, and accepts the device's local date (bounded to the server date + 1
-- day so a client can't post far-future instances early).
drop function if exists public.post_recurring_rule(uuid);

create or replace function public.post_recurring_rule(p_id uuid, p_today date default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule  public.recurring_rules;
  v_txn   public.transactions;
  v_today date := least(coalesce(p_today, current_date), current_date + 1);
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_rule from public.recurring_rules where id = p_id for update;
  if v_rule.id is null or not public.is_household_member(v_rule.household_id) then
    raise exception 'Recurring rule not found' using errcode = 'no_data_found';
  end if;
  if v_rule.next_due_date > v_today then
    return null;
  end if;
  if v_rule.end_date is not null and v_rule.next_due_date > v_rule.end_date then
    return null;
  end if;

  v_txn := public.create_transaction(
    p_account_id   => v_rule.account_id,
    p_type         => v_rule.type,
    p_amount_cents => v_rule.amount_cents,
    p_date         => v_rule.next_due_date,
    p_category_id  => v_rule.category_id,
    p_merchant     => v_rule.name
  );

  update public.recurring_rules
    set next_due_date = public.advance_recurring_date(v_rule.next_due_date, v_rule.frequency)
    where id = p_id;

  return v_txn.id;
end;
$$;

-- contribute_to_goal: a NULL delta used to reset the goal to 0; linked goals
-- and foreign goals now raise instead of silently returning NULL.
create or replace function public.contribute_to_goal(p_id uuid, p_delta bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_goal public.savings_goals;
  v_new  bigint;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if p_delta is null then
    raise exception 'Amount is required' using errcode = '22023';
  end if;

  select * into v_goal from public.savings_goals where id = p_id for update;
  if v_goal.id is null or not public.is_household_member(v_goal.household_id) then
    raise exception 'Goal not found' using errcode = 'no_data_found';
  end if;
  if v_goal.linked_account_id is not null then
    raise exception 'This goal tracks an account balance' using errcode = '22023';
  end if;

  update public.savings_goals
    set current_amount_cents = greatest(0, current_amount_cents + p_delta)
    where id = p_id
    returning current_amount_cents into v_new;
  return v_new;
end;
$$;

-- category_period_spend: optional household scope (the web app calls it with
-- three named args and keeps working; the iOS app passes p_household_id).
drop function if exists public.category_period_spend(uuid, date, date);

create or replace function public.category_period_spend(
  p_category_id  uuid,
  p_start        date,
  p_end          date,
  p_household_id uuid default null
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
    and (p_household_id is null or t.household_id = p_household_id)
    and (
      t.split_parent_id is not null
      or not exists (
        select 1 from public.transactions c where c.split_parent_id = t.id
      )
    );
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Table privileges: ledger + goal progress only change through the RPCs
-- ─────────────────────────────────────────────────────────────────────────────
revoke insert, update, delete on public.transactions from authenticated, anon;
grant update (receipt_url) on public.transactions to authenticated;

revoke update on public.savings_goals from authenticated, anon;
grant update (name, target_amount_cents, target_date, linked_account_id, color, icon)
  on public.savings_goals to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Households & membership
-- ─────────────────────────────────────────────────────────────────────────────

-- Invite codes are 8 chars from the unambiguous alphabet used by both clients.
-- NOT VALID: enforced on new writes without re-checking existing rows.
alter table public.households drop constraint if exists households_invite_code_format;
alter table public.households
  add constraint households_invite_code_format
  check (invite_code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$') not valid;

alter table public.households drop constraint if exists households_name_length;
alter table public.households
  add constraint households_name_length
  check (char_length(btrim(name)) between 1 and 60) not valid;

-- Members join only through join_household_by_invite (the owner can no longer
-- insert arbitrary users, which also exposed their email). The owner may still
-- remove other members, but not their own row.
drop policy if exists household_members_insert_owner on public.household_members;
drop policy if exists household_members_update_owner on public.household_members;
drop policy if exists household_members_delete_owner on public.household_members;
create policy household_members_delete_owner on public.household_members
  for delete using (
    household_id in (select public.current_user_owned_household_ids())
    and user_id <> auth.uid()
  );
revoke insert, update on public.household_members from authenticated, anon;

-- One household per user (the app is single-household by design).
create or replace function public.create_household_with_owner(p_name text, p_invite_code text)
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
  if exists (select 1 from public.household_members where user_id = v_user) then
    raise exception 'Already a member of a household' using errcode = '23505';
  end if;

  insert into public.households (name, owner_id, invite_code)
  values (btrim(p_name), v_user, upper(btrim(p_invite_code)))
  returning * into v_household;

  insert into public.household_members (household_id, user_id, role)
  values (v_household.id, v_user, 'owner');

  return v_household;
end;
$$;

create or replace function public.join_household_by_invite(p_invite_code text)
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
  where invite_code = upper(regexp_replace(coalesce(p_invite_code, ''), '\s', '', 'g'));

  if v_household.id is null then
    raise exception 'Invalid invite code' using errcode = 'no_data_found';
  end if;

  if exists (
    select 1 from public.household_members
    where user_id = v_user and household_id <> v_household.id
  ) then
    raise exception 'Already a member of a household' using errcode = '23505';
  end if;

  insert into public.household_members (household_id, user_id, role)
  values (v_household.id, v_user, 'member')
  on conflict (household_id, user_id) do nothing;

  return v_household;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Profiles: email comes from auth only (co-members see it)
-- ─────────────────────────────────────────────────────────────────────────────
revoke update on public.profiles from authenticated, anon;
grant update (full_name, avatar_url, default_currency, locale, fiscal_month_start_day)
  on public.profiles to authenticated;

alter table public.profiles drop constraint if exists profiles_default_currency_format;
alter table public.profiles
  add constraint profiles_default_currency_format
  check (default_currency ~ '^[A-Z]{3}$') not valid;

create or replace function public.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function public.sync_profile_email();

-- ─────────────────────────────────────────────────────────────────────────────
-- Function privileges. Supabase grants EXECUTE on new public functions to
-- anon/authenticated by default; make every grant explicit.
-- ─────────────────────────────────────────────────────────────────────────────

-- Internal: triggers and helpers never called by clients.
revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.sync_profile_email() from public, anon, authenticated;
revoke all on function public.reject_household_move() from public, anon, authenticated;
revoke all on function public.check_transaction_refs() from public, anon, authenticated;
revoke all on function public.check_category_refs() from public, anon, authenticated;
revoke all on function public.check_budget_refs() from public, anon, authenticated;
revoke all on function public.check_recurring_refs() from public, anon, authenticated;
revoke all on function public.check_linked_account_ref() from public, anon, authenticated;
revoke all on function public.is_household_member(uuid) from public, anon, authenticated;
revoke all on function public.assert_account_in_household(uuid, uuid) from public, anon, authenticated;
revoke all on function public.assert_category_usable(uuid, uuid, public.category_kind) from public, anon, authenticated;
-- Rebuilds balances from the ledger only and would wipe manual starting
-- balances; keep it for service-role maintenance.
revoke all on function public.recompute_account_balance(uuid) from public, anon, authenticated;

-- Used inside RLS policies, so signed-in users must be able to execute them.
revoke all on function public.current_user_household_ids() from public, anon;
revoke all on function public.current_user_owned_household_ids() from public, anon;
grant execute on function public.current_user_household_ids() to authenticated;
grant execute on function public.current_user_owned_household_ids() to authenticated;

-- Client-callable RPCs: signed-in users only.
revoke all on function public.create_household_with_owner(text, text) from public, anon;
revoke all on function public.join_household_by_invite(text) from public, anon;
revoke all on function public.transaction_balance_delta(public.transaction_type, bigint) from public, anon;
revoke all on function public.create_transaction(uuid, public.transaction_type, bigint, date, uuid, text, text, text, boolean, public.transaction_source, text) from public, anon;
revoke all on function public.update_transaction(uuid, uuid, public.transaction_type, bigint, date, uuid, text, text, text, boolean) from public, anon;
revoke all on function public.delete_transaction(uuid) from public, anon;
revoke all on function public.split_transaction(uuid, jsonb) from public, anon;
revoke all on function public.advance_recurring_date(date, public.recurring_frequency) from public, anon;
revoke all on function public.post_recurring_rule(uuid, date) from public, anon;
revoke all on function public.contribute_to_goal(uuid, bigint) from public, anon;
revoke all on function public.category_period_spend(uuid, date, date, uuid) from public, anon;
revoke all on function public.check_ai_rate_limit(uuid, text, int) from public, anon;

grant execute on function public.create_household_with_owner(text, text) to authenticated;
grant execute on function public.join_household_by_invite(text) to authenticated;
grant execute on function public.transaction_balance_delta(public.transaction_type, bigint) to authenticated;
grant execute on function public.create_transaction(uuid, public.transaction_type, bigint, date, uuid, text, text, text, boolean, public.transaction_source, text) to authenticated;
grant execute on function public.update_transaction(uuid, uuid, public.transaction_type, bigint, date, uuid, text, text, text, boolean) to authenticated;
grant execute on function public.delete_transaction(uuid) to authenticated;
grant execute on function public.split_transaction(uuid, jsonb) to authenticated;
grant execute on function public.advance_recurring_date(date, public.recurring_frequency) to authenticated;
grant execute on function public.post_recurring_rule(uuid, date) to authenticated;
grant execute on function public.contribute_to_goal(uuid, bigint) to authenticated;
grant execute on function public.category_period_spend(uuid, date, date, uuid) to authenticated;
grant execute on function public.check_ai_rate_limit(uuid, text, int) to authenticated;
