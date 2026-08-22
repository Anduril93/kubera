-- ============================================================================
-- 0005_transactions_created_by_set_null.sql
-- Bug fix: transactions.created_by referenced profiles(id) with the default
-- ON DELETE NO ACTION (RESTRICT), so deleting a profile/user who had entered
-- any transaction failed with a foreign-key violation. A household must be able
-- to remove a member without losing the ledger — the transaction should remain
-- with created_by set to NULL ("entered by" simply becomes unknown).
--
-- Safe to re-run.
-- ============================================================================

alter table public.transactions
  drop constraint if exists transactions_created_by_fkey;

alter table public.transactions
  add constraint transactions_created_by_fkey
  foreign key (created_by) references public.profiles (id) on delete set null;
