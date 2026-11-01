-- Starting price (AED) for packages and services, same as pb_venues.price_from. Empty = no price shown.
alter table public.pb_services add column if not exists price_from numeric;
alter table public.pb_services drop constraint if exists pb_services_price_from_chk;
alter table public.pb_services add constraint pb_services_price_from_chk check (price_from is null or price_from >= 0);
