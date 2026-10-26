alter table public.pb_settings
  add column if not exists other_venue jsonb not null default
  '{"show":true,"name":"Other venues","tagline":"Hotel, villa, park, home or any venue","description":"We bring our packages, styling and team to your chosen hotel, villa, park, home or other venue in Abu Dhabi. Tell us where, then pick your packages and services.","image":"assets/parade-images/pic3.webp","imagePos":""}'::jsonb;

create or replace function public.pb_public_other_venue()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select other_venue
  from public.pb_settings
  where id = 1;
$$;

revoke all on function public.pb_public_other_venue() from public;
grant execute on function public.pb_public_other_venue() to anon, authenticated;
