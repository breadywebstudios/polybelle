-- Invoice PDFs shared with customers through short-lived links
-- (Admin → booking → Invoice → Send invoice to customer).
-- A private bucket keeps invoices out of the public photos bucket, and a 7-day signed link is put in the
-- WhatsApp message. Without this migration the app falls back to the public `polybelle` bucket.
insert into storage.buckets (id, name, public)
values ('invoices', 'invoices', false)
on conflict (id) do nothing;

drop policy if exists "Polybelle admins upload invoice PDFs" on storage.objects;
create policy "Polybelle admins upload invoice PDFs"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'invoices' and public.pb_is_admin());

drop policy if exists "Polybelle admins update invoice PDFs" on storage.objects;
create policy "Polybelle admins update invoice PDFs"
  on storage.objects for update to authenticated
  using (bucket_id = 'invoices' and public.pb_is_admin())
  with check (bucket_id = 'invoices' and public.pb_is_admin());

-- SELECT is what lets the admin create the signed link the customer opens.
drop policy if exists "Polybelle admins read invoice PDFs" on storage.objects;
create policy "Polybelle admins read invoice PDFs"
  on storage.objects for select to authenticated
  using (bucket_id = 'invoices' and public.pb_is_admin());
