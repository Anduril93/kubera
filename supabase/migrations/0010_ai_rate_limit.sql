-- ============================================================================
-- 0010_ai_rate_limit.sql
-- Per-user daily AI usage limiter that src/lib/rate-limit.ts has been calling
-- since 0.3. check_ai_rate_limit() atomically increments today's count for the
-- (user, feature) and returns the NEW count; the TS helper decides allowed =
-- (count <= limit) and fails closed on any error.
--
-- Safe to re-run.
-- ============================================================================

create table if not exists public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  feature text not null,
  day     date not null default current_date,
  count   int  not null default 0,
  primary key (user_id, feature, day)
);

alter table public.ai_usage enable row level security;

-- Users may read their own usage; writes happen only through the SECURITY
-- DEFINER function below (no direct write policy).
drop policy if exists ai_usage_select_own on public.ai_usage;
create policy ai_usage_select_own on public.ai_usage
  for select using (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- check_ai_rate_limit — increment today's usage for the caller + feature and
-- return the new count. Uses auth.uid() (never trusts p_user_id) so one user
-- can't consume another's quota. p_limit is accepted for signature stability;
-- the allowed/blocked decision is made by the caller against the returned count.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.check_ai_rate_limit(
  p_user_id uuid,
  p_feature text,
  p_limit   int
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user  uuid := auth.uid();
  v_count int;
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  insert into public.ai_usage (user_id, feature, day, count)
  values (v_user, p_feature, current_date, 1)
  on conflict (user_id, feature, day)
  do update set count = public.ai_usage.count + 1
  returning count into v_count;

  return v_count;
end;
$$;

grant select on public.ai_usage to authenticated, service_role;
grant execute on function public.check_ai_rate_limit(uuid, text, int) to authenticated, service_role;
