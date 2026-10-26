alter table public.pb_venues
  add column if not exists google_maps_url text;
