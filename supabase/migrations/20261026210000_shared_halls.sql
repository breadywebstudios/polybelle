-- Halls that share space (e.g. "Hall A&B" includes "Hall B"): a confirmed booking in one blocks the same
-- session in the other. Links work both ways. Applied to the live project on 2026-10-26.
alter table public.pb_venues add column if not exists shares_with uuid[] not null default '{}';

update public.pb_venues set shares_with = array['66bb0de2-c35d-4299-bde6-40471b6d445b'::uuid]   -- Hall A&B shares with Hall B
 where id = '8e576d92-bf04-409f-ab45-c2aded5ad0fa' and not ('66bb0de2-c35d-4299-bde6-40471b6d445b'::uuid = any(shares_with));

create or replace function public.pb_linked_venues(p_venue uuid)
returns uuid[] language sql stable security definer set search_path to '' as $$
  select array_agg(distinct x) from (
    select p_venue as x
    union select unnest(v.shares_with) from public.pb_venues v where v.id = p_venue
    union select v.id from public.pb_venues v where p_venue = any(v.shares_with)
  ) s;
$$;
revoke all on function public.pb_linked_venues(uuid) from public;

-- pb_request_booking: the hall clash check now uses
--   b.venue_id = any(public.pb_linked_venues(v_venue.id))
-- instead of b.venue_id = v_venue.id (rest of the function unchanged).
