-- Six choices: Hall A, Hall B, Hall C, Hall D, Hall A&B (+ Other venues on the website).
-- The original record goes back to "Hall A&B"; a new "Hall A" is added. Hall A&B shares space with
-- Hall A and Hall B (booking it blocks both, and either of them blocks it); A and B don't block each other.
do $$
declare ab uuid := '8e576d92-bf04-409f-ab45-c2aded5ad0fa'; hb uuid := '66bb0de2-c35d-4299-bde6-40471b6d445b'; ha uuid;
begin
  insert into public.pb_venues(name, tagline, description, capacity, branch, image_url, price_from, sort_order, active, image_pos, google_maps_url, venue_address, shares_with)
  select 'Hall A', tagline, 'A bright hall for birthdays, showers and intimate celebrations.', 70, branch, image_url, null, 1, true, image_pos, google_maps_url, venue_address, array[ab]
    from public.pb_venues where id = ab
  returning id into ha;
  update public.pb_venues set name = 'Hall A&B', capacity = 100, sort_order = 5, shares_with = array[ha, hb] where id = ab;
  update public.pb_venues set shares_with = array[ab] where id = hb;
  update public.pb_bookings set extra_venue_ids = '{}', venue_name = 'Hall A&B' where venue_id = ab;
end $$;
