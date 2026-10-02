-- ============================================================================
-- 0012_receipts_storage.sql
-- Private Supabase Storage bucket for receipts (replaces Cloudflare R2 for the
-- native app). Objects live at <household_id>/<uuid>.<ext> inside the
-- `receipts` bucket; transactions.receipt_url stores "receipts/<that path>",
-- the same key shape the web app used for R2, so 0011's format check covers
-- both. There is no public URL — clients get short-lived signed URLs, which
-- storage only issues to callers these policies allow to SELECT the object.
--
-- Uploads are create-only (no UPDATE policy → no overwriting someone else's
-- object). The bucket's size + MIME limits are the first gate; the
-- scan-receipt Edge Function re-checks magic bytes before using a file.
--
-- Safe to re-run.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'receipts', 'receipts', false, 10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update set
  public             = false,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists receipts_select_member on storage.objects;
drop policy if exists receipts_insert_member on storage.objects;
drop policy if exists receipts_delete_member on storage.objects;

create policy receipts_select_member on storage.objects
  for select to authenticated
  using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] in (
      select h::text from public.current_user_household_ids() h
    )
  );

create policy receipts_insert_member on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] in (
      select h::text from public.current_user_household_ids() h
    )
  );

create policy receipts_delete_member on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] in (
      select h::text from public.current_user_household_ids() h
    )
  );
