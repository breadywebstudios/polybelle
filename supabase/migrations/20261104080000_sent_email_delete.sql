-- Admins can delete emails from the Sent list (Admin → Send Mail → Sent emails).
drop policy if exists pb_emails_admin_delete on public.pb_emails;
create policy pb_emails_admin_delete on public.pb_emails for delete to authenticated
  using ((select public.pb_is_admin()));
grant delete on public.pb_emails to authenticated;
