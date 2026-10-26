alter table public.pb_venues
  add column if not exists venue_address text;
