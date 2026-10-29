-- Emails received at @polybelle.me (Admin → Inbox).
-- Resend receives the mail and calls the public "email-inbound" Edge Function (signed webhook), which
-- fetches the full message, copies attachments into the private "inbox" bucket and stores a row here.
create table if not exists public.pb_inbox (
  id            uuid primary key default gen_random_uuid(),
  resend_id     text not null unique,              -- Resend email_id; retried webhooks don't duplicate
  received_at   timestamptz not null default now(),
  from_address  text not null,
  from_name     text,
  to_addresses  text[] not null default '{}',
  cc_addresses  text[] not null default '{}',
  received_for  text[] not null default '{}',     -- our address(es) it was delivered to, including BCC
  reply_to     text[] not null default '{}',
  subject       text not null default '',
  body_text     text,
  body_html     text,
  message_id    text,
  "references"  text,
  attachments   jsonb not null default '[]',       -- [{filename, content_type, size, path, inline, content_id}]
  auth          jsonb,                             -- SPF / DKIM / DMARC results from Resend
  is_read       boolean not null default false,
  archived      boolean not null default false,
  replied_at    timestamptz
);
create index if not exists pb_inbox_received_at_idx on public.pb_inbox (received_at desc);
create index if not exists pb_inbox_from_idx on public.pb_inbox (from_address);

alter table public.pb_inbox enable row level security;
drop policy if exists pb_inbox_admin_read on public.pb_inbox;
create policy pb_inbox_admin_read on public.pb_inbox for select to authenticated
  using ((select public.pb_is_admin()));
-- admins mark read/unread and archive; everything else is written by the Edge Functions
drop policy if exists pb_inbox_admin_update on public.pb_inbox;
create policy pb_inbox_admin_update on public.pb_inbox for update to authenticated
  using ((select public.pb_is_admin())) with check ((select public.pb_is_admin()));
drop policy if exists pb_inbox_admin_delete on public.pb_inbox;
create policy pb_inbox_admin_delete on public.pb_inbox for delete to authenticated
  using ((select public.pb_is_admin()));
revoke update on public.pb_inbox from authenticated;
grant update (is_read, archived) on public.pb_inbox to authenticated;

-- replies sent from the admin point at the email they answer
alter table public.pb_emails add column if not exists inbox_id uuid;
alter table public.pb_emails drop constraint if exists pb_emails_inbox_id_fkey;
alter table public.pb_emails add constraint pb_emails_inbox_id_fkey
  foreign key (inbox_id) references public.pb_inbox(id) on delete set null;

-- private bucket for received attachments (admins open them through short signed links)
insert into storage.buckets (id, name, public, file_size_limit)
values ('inbox', 'inbox', false, 26214400)
on conflict (id) do nothing;

drop policy if exists "Polybelle admins read inbox files" on storage.objects;
create policy "Polybelle admins read inbox files"
  on storage.objects for select to authenticated
  using (bucket_id = 'inbox' and public.pb_is_admin());
drop policy if exists "Polybelle admins delete inbox files" on storage.objects;
create policy "Polybelle admins delete inbox files"
  on storage.objects for delete to authenticated
  using (bucket_id = 'inbox' and public.pb_is_admin());
