-- ============================================================================
-- 0014_plaid_sync_refinements.sql
-- Follow-ups from testing 0013 against Plaid Sandbox:
--   * Money coming INTO a credit card or loan account is a payment toward it,
--     not income or a refund — categorize it as Transfer (excluded from the
--     dashboard's income/expense) instead of "Refunds".
--   * The initial 90-day history no longer floods the review inbox: bank
--     transactions dated more than a week before the bank was linked arrive
--     already reviewed. Auto-matches always go to review.
--   * Data fix for rows already imported under 0013.
--
-- Safe to re-run.
-- ============================================================================

drop function if exists public.plaid_category_name(text, text, boolean);

-- Plaid personal_finance_category → our system category name.
create or replace function public.plaid_category_name(
  p_detailed  text,
  p_primary   text,
  p_inflow    boolean,
  p_liability boolean default false
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_inflow and p_liability then 'Transfer'
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
  v_liability boolean;
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
    v_liability := v_acct.type in ('credit_card', 'loan');
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
          v_inflow,
          v_liability)
      limit 1;

    insert into public.transactions (
      household_id, account_id, category_id, type, amount_cents, currency, date,
      merchant, pending, source, plaid_transaction_id, bank_snapshot, review_state
    ) values (
      v_item.household_id, v_acct.id, v_cat, v_type, v_cents,
      coalesce(v_t->>'iso_currency_code', v_acct.currency), v_date,
      v_merchant, (v_t->>'pending')::boolean, 'imported',
      v_t->>'transaction_id', v_snap,
      -- History from before the link (older than a week) arrives already
      -- reviewed; only recent activity goes to the inbox.
      case when v_date < v_item.created_at::date - 7 then 'reviewed' else 'needs_review' end
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

-- ─────────────────────────────────────────────────────────────────────────────
-- Data fix for imports made under 0013
-- ─────────────────────────────────────────────────────────────────────────────
update public.transactions t
  set category_id = (select id from public.categories where household_id is null and name = 'Transfer' limit 1)
  from public.accounts a
  where a.id = t.account_id
    and a.type in ('credit_card', 'loan')
    and t.source = 'imported'
    and t.type = 'income'
    and t.match_state is null
    and t.category_id = (select id from public.categories where household_id is null and name = 'Refunds' and kind = 'income' limit 1);

update public.transactions t
  set review_state = 'reviewed'
  from public.accounts a
  join public.plaid_items i on i.id = a.plaid_item_id
  where a.id = t.account_id
    and t.source = 'imported'
    and t.match_state is null
    and t.review_state = 'needs_review'
    and t.date < i.created_at::date - 7;

-- ─────────────────────────────────────────────────────────────────────────────
-- Privileges (service role only, as in 0013)
-- ─────────────────────────────────────────────────────────────────────────────
revoke all on function public.plaid_category_name(text, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.plaid_category_name(text, text, boolean, boolean) to service_role;
revoke all on function public.plaid_apply_sync(uuid, jsonb, jsonb, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.plaid_apply_sync(uuid, jsonb, jsonb, jsonb, jsonb, text) to service_role;
