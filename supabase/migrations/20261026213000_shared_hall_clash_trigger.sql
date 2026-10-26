-- Applied to the live project on 2026-10-26 during the full check.
-- 1) venue_address column (from 20261026212100_venue_address.sql) had not been applied yet.
alter table public.pb_venues add column if not exists venue_address text;

-- 2) The clash trigger also blocks confirming a booking when a hall sharing its space is already confirmed.
create or replace function public.pb_check_clash()
 returns trigger language plpgsql security definer set search_path to '' as $function$
begin
  if new.status = 'Confirmed' and new.venue_id is not null and exists (
    select 1 from public.pb_bookings b
    where b.id <> new.id and b.status = 'Confirmed' and b.venue_id = any(public.pb_linked_venues(new.venue_id))
      and b.event_date = new.event_date
      and (b.session = new.session or b.session = 'Whole day' or new.session = 'Whole day')
  ) then
    raise exception 'This hall (or a hall sharing its space) already has a confirmed booking for that date and session';
  end if;
  return new;
end; $function$;

-- 3) pb_linked_venues is only used inside the database.
revoke execute on function public.pb_linked_venues(uuid) from anon, authenticated;
