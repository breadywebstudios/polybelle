-- Photo framing: which part of a hall / package / service photo shows in its card.
-- Stored as a CSS position like '50% 30%' (horizontal vertical). Empty = centered.
alter table public.pb_venues   add column if not exists image_pos text;
alter table public.pb_services add column if not exists image_pos text;
alter table public.pb_venues   drop constraint if exists pb_venues_image_pos_chk;
alter table public.pb_services drop constraint if exists pb_services_image_pos_chk;
alter table public.pb_venues   add constraint pb_venues_image_pos_chk   check (image_pos is null or image_pos ~ '^(100|[0-9]{1,2})% (100|[0-9]{1,2})%$');
alter table public.pb_services add constraint pb_services_image_pos_chk check (image_pos is null or image_pos ~ '^(100|[0-9]{1,2})% (100|[0-9]{1,2})%$');
