-- Emails sent from Admin → Email (from an @polybelle.me address, through Resend).
-- The "admin-send-email" Edge Function writes each row with the service-role key; admins can read the log.
create table if not exists public.pb_emails (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  sent_by      text not null,
  from_address text not null,
  to_addresses text[] not null,
  cc_addresses text[] not null default '{}',
  reply_to     text,
  subject      text not null,
  body         text not null,
  attachments  text[] not null default '{}',
  booking_ref  text,
  inbox_id     uuid,                          -- the Inbox email this replies to (linked in the Inbox migration)
  status      text not null default 'Sent' check (status in ('Sent', 'Failed')),
  provider_id  text,
  error        text
);
create index if not exists pb_emails_created_at_idx on public.pb_emails (created_at desc);
create index if not exists pb_emails_booking_ref_idx on public.pb_emails (booking_ref);

alter table public.pb_emails enable row level security;
drop policy if exists pb_emails_admin_read on public.pb_emails;
create policy pb_emails_admin_read on public.pb_emails for select to authenticated
  using ((select public.pb_is_admin()));
