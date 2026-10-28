-- Short, clean invoice links for WhatsApp: https://www.polybelle.me/i/<code>
-- Each booking gets one code that always opens its LATEST invoice/receipt PDF (stored privately in the
-- "invoices" bucket). The public "invoice" Edge Function looks the code up and streams the PDF.
create table if not exists public.pb_invoice_files (
  code        text primary key check (code ~ '^[A-Za-z0-9]{8,16}$'),
  booking_id  uuid not null unique references public.pb_bookings(id) on delete cascade,
  path        text not null,
  file_name   text not null,
  doc_type    text not null default 'Invoice',
  invoice_no  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.pb_invoice_files enable row level security;
drop policy if exists pb_invoice_files_admin on public.pb_invoice_files;
create policy pb_invoice_files_admin on public.pb_invoice_files for all to authenticated
  using ((select public.pb_is_admin())) with check ((select public.pb_is_admin()));

-- private bucket for invoice PDFs only (created by 20261028120000_invoice_pdf_links.sql)
update storage.buckets set public = false, file_size_limit = 10485760, allowed_mime_types = array['application/pdf'] where id = 'invoices';

-- admins may remove older versions of an invoice PDF
drop policy if exists "Polybelle admins delete invoice PDFs" on storage.objects;
create policy "Polybelle admins delete invoice PDFs"
  on storage.objects for delete to authenticated
  using (bucket_id = 'invoices' and public.pb_is_admin());
