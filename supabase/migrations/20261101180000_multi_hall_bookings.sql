-- One booking can take several halls on the same date and session.
-- venue_id stays the first hall; extra_venue_ids holds the others.
alter table public.pb_bookings add column if not exists extra_venue_ids uuid[] not null default '{}';

-- every hall a booking uses
create or replace function public.pb_booking_halls(p_venue uuid, p_extra uuid[])
returns uuid[] language sql immutable set search_path to '' as $$
  select coalesce(array_agg(distinct x), '{}') from unnest(array[p_venue] || coalesce(p_extra, '{}')) x where x is not null;
$$;

-- those halls plus every hall that shares space with any of them
create or replace function public.pb_linked_venues_many(p_venues uuid[])
returns uuid[] language sql stable security definer set search_path to '' as $$
  select coalesce(array_agg(distinct x), '{}') from (
    select unnest(public.pb_linked_venues(v)) x from unnest(p_venues) v
  ) s where x is not null;
$$;
revoke all on function public.pb_linked_venues_many(uuid[]) from public, anon, authenticated;

create or replace function public.pb_check_clash()
returns trigger language plpgsql security definer set search_path to '' as $$
declare v_halls uuid[] := public.pb_booking_halls(new.venue_id, new.extra_venue_ids);
begin
  if new.status = 'Confirmed' and cardinality(v_halls) > 0 and exists (
    select 1 from public.pb_bookings b
    where b.id <> new.id and b.status = 'Confirmed'
      and public.pb_booking_halls(b.venue_id, b.extra_venue_ids) && public.pb_linked_venues_many(v_halls)
      and b.event_date = new.event_date
      and (b.session = new.session or b.session = 'Whole day' or new.session = 'Whole day')
  ) then
    raise exception 'This hall (or a hall sharing its space) already has a confirmed booking for that date and session';
  end if;
  return new;
end; $$;

-- one row per hall, so the website calendar blocks every hall of a multi-hall booking
create or replace function public.pb_booked_slots()
returns table(venue_id uuid, event_date date, session text)
language sql stable security definer set search_path to '' as $$
  select h, b.event_date, b.session from public.pb_bookings b
  cross join lateral unnest(case when b.venue_id is null then array[null::uuid]
                                 else public.pb_booking_halls(b.venue_id, b.extra_venue_ids) end) h
  where b.status = 'Confirmed' and b.event_date >= (now() at time zone 'Asia/Dubai')::date;
$$;

-- accepts venue_ids (list of halls); venue_id alone still works
create or replace function public.pb_request_booking(p jsonb)
returns text language plpgsql security definer set search_path to '' as $$
declare
  v_ref text;
  v_type text := case when p->>'booking_type' = 'Services' then 'Services' else 'Hall' end;
  v_ids uuid[];
  v_halls uuid[];
  v_names text;
  v_date date := nullif(p->>'date','')::date;
  v_session text := p->>'session';
  v_name text := left(trim(coalesce(p->>'name','')), 120);
  v_phone text := left(trim(coalesce(p->>'phone','')), 40);
  v_today date := (now() at time zone 'Asia/Dubai')::date;
  v_addons text[];
  v_location text := nullif(left(trim(coalesce(p->>'event_location','')), 200), '');
begin
  if v_name = '' or v_phone = '' then raise exception 'Name and phone are required'; end if;
  if v_date is null or v_date < v_today then raise exception 'Please choose a future date'; end if;
  if v_date > v_today + 730 then raise exception 'Bookings open up to 2 years ahead'; end if;
  if v_session not in ('Morning','Afternoon','Evening','Whole day') then raise exception 'Please choose a session'; end if;
  select coalesce(array_agg(left(x,60)), '{}') into v_addons
    from (select jsonb_array_elements_text(coalesce(p->'add_ons','[]'::jsonb)) x limit 15) s;

  if v_type = 'Hall' then
    if jsonb_typeof(p->'venue_ids') = 'array' then
      select array_agg(x::uuid) into v_ids from (select jsonb_array_elements_text(p->'venue_ids') x limit 10) s where x <> '';
    end if;
    if v_ids is null then v_ids := array[nullif(p->>'venue_id','')::uuid]; end if;
    -- keep the customer's order, only active halls, no repeats
    select array_agg(v.id order by array_position(v_ids, v.id)), string_agg(v.name, ' + ' order by array_position(v_ids, v.id))
      into v_halls, v_names
      from public.pb_venues v where v.id = any(v_ids) and v.active;
    if v_halls is null or cardinality(v_halls) <> (select count(distinct x) from unnest(v_ids) x where x is not null) then
      raise exception 'Please choose a hall';
    end if;
    if exists (select 1 from public.pb_bookings b where b.status='Confirmed'
               and public.pb_booking_halls(b.venue_id, b.extra_venue_ids) && public.pb_linked_venues_many(v_halls)
               and b.event_date=v_date and (b.session=v_session or b.session='Whole day' or v_session='Whole day')) then
      raise exception 'Sorry, that hall is already booked for this date and session';
    end if;
  else
    if coalesce(array_length(v_addons, 1), 0) = 0 then raise exception 'Please choose at least one package or service'; end if;
  end if;

  v_ref := 'PB-' || to_char(now() at time zone 'Asia/Dubai','YYMMDD') || '-' || upper(substr(md5(gen_random_uuid()::text),1,4));
  insert into public.pb_bookings(ref, booking_type, venue_id, extra_venue_ids, venue_name, event_location, event_date, session, event_type, guests, add_ons, name, phone, email, notes)
  values (v_ref, v_type,
          case when v_type = 'Hall' then v_halls[1] end,
          case when v_type = 'Hall' then coalesce(v_halls[2:], '{}') else '{}' end,
          case when v_type = 'Hall' then v_names end,
          v_location, v_date, v_session,
          left(coalesce(nullif(trim(p->>'event_type'),''),'Celebration'),60),
          nullif(p->>'guests','')::int, v_addons, v_name, v_phone,
          nullif(left(trim(coalesce(p->>'email','')),160),''),
          nullif(left(trim(coalesce(p->>'notes','')),1500),''));
  return v_ref;
end; $$;

-- "Hall A&B" becomes "Hall A", its own room separate from Hall B.
-- Its existing bookings were for the whole A&B space, so they now hold Hall A + Hall B.
update public.pb_bookings
   set extra_venue_ids = array['66bb0de2-c35d-4299-bde6-40471b6d445b'::uuid], venue_name = 'Hall A + Hall B'
 where venue_id = '8e576d92-bf04-409f-ab45-c2aded5ad0fa' and extra_venue_ids = '{}';
update public.pb_venues set name = 'Hall A', capacity = 70, shares_with = '{}'
 where id = '8e576d92-bf04-409f-ab45-c2aded5ad0fa';
update public.pb_venues set shares_with = array_remove(shares_with, '8e576d92-bf04-409f-ab45-c2aded5ad0fa'::uuid)
 where id = '66bb0de2-c35d-4299-bde6-40471b6d445b';
