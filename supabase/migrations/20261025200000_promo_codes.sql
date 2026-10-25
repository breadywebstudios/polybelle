create table if not exists public.pb_promo_codes (
  code text primary key check (code = upper(code) and code ~ '^[A-Z0-9_-]{2,40}$'),
  discount_type text not null default 'percentage',
  discount_value numeric(10, 2) not null,
  required_item text not null check (length(btrim(required_item)) > 0),
  max_uses integer not null check (max_uses > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pb_promo_redemptions (
  id bigint generated always as identity primary key,
  promo_code text not null references public.pb_promo_codes(code) on update cascade on delete restrict,
  booking_ref text not null,
  discount_type text not null default 'percentage',
  discount_value numeric(10, 2) not null,
  required_item text not null,
  redeemed_at timestamptz not null default now(),
  unique (promo_code, booking_ref)
);

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'pb_promo_codes' and column_name = 'discount_percent'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'pb_promo_codes' and column_name = 'discount_value'
  ) then
    alter table public.pb_promo_codes rename column discount_percent to discount_value;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'pb_promo_redemptions' and column_name = 'discount_percent'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'pb_promo_redemptions' and column_name = 'discount_value'
  ) then
    alter table public.pb_promo_redemptions rename column discount_percent to discount_value;
  end if;
end;
$$;

alter table public.pb_promo_codes add column if not exists discount_type text not null default 'percentage';
alter table public.pb_promo_codes add column if not exists discount_value numeric(10, 2);
alter table public.pb_promo_codes alter column discount_value type numeric(10, 2);
alter table public.pb_promo_codes drop constraint if exists pb_promo_codes_discount_percent_check;
alter table public.pb_promo_codes drop constraint if exists pb_promo_codes_discount_value_check;
alter table public.pb_promo_codes drop constraint if exists pb_promo_codes_discount_type_check;
alter table public.pb_promo_codes
  add constraint pb_promo_codes_discount_type_check check (discount_type in ('percentage', 'fixed')),
  add constraint pb_promo_codes_discount_value_check
    check (discount_value > 0 and (discount_type = 'fixed' or discount_value <= 100));

alter table public.pb_promo_redemptions add column if not exists discount_type text not null default 'percentage';
alter table public.pb_promo_redemptions add column if not exists discount_value numeric(10, 2);
alter table public.pb_promo_redemptions alter column discount_value type numeric(10, 2);

create index if not exists pb_promo_redemptions_booking_ref_idx
  on public.pb_promo_redemptions (booking_ref);

alter table public.pb_promo_codes enable row level security;
alter table public.pb_promo_redemptions enable row level security;

drop policy if exists "Admins manage promo codes" on public.pb_promo_codes;
create policy "Admins manage promo codes"
  on public.pb_promo_codes for all to authenticated
  using (public.pb_is_admin())
  with check (public.pb_is_admin());

drop policy if exists "Public can view active promo codes" on public.pb_promo_codes;
create policy "Public can view active promo codes"
  on public.pb_promo_codes for select to anon, authenticated
  using (is_active);

drop policy if exists "Admins view promo redemptions" on public.pb_promo_redemptions;
create policy "Admins view promo redemptions"
  on public.pb_promo_redemptions for select to authenticated
  using (public.pb_is_admin());

grant select, insert, update, delete on public.pb_promo_codes to authenticated;
grant select on public.pb_promo_codes to anon;
grant select on public.pb_promo_redemptions to authenticated;

insert into public.pb_promo_codes (code, discount_type, discount_value, required_item, max_uses, is_active)
values ('MASCOT15', 'percentage', 15, 'Mascot Surprise', 10, true)
on conflict (code) do nothing;

drop function if exists public.pb_public_promos();
create or replace function public.pb_public_promos()
returns table (code text, discount_type text, discount_value numeric, required_item text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.code, p.discount_type, p.discount_value, p.required_item
  from public.pb_promo_codes p
  where p.is_active
  order by p.created_at desc, p.code;
$$;

create or replace function public.pb_admin_promo_stats()
returns table (promo_code text, used_count bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.pb_is_admin() then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;

  return query
    select p.code, count(r.id)
    from public.pb_promo_codes p
    left join public.pb_promo_redemptions r on r.promo_code = p.code
    group by p.code;
end;
$$;

create or replace function public.pb_request_booking_with_promo(p jsonb, p_promo_code text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_promo public.pb_promo_codes%rowtype;
  v_booking_payload jsonb;
  v_booking_ref text;
  v_used bigint;
  v_code text := upper(btrim(coalesce(p_promo_code, '')));
  v_has_required_item boolean;
  v_discount text;
  v_discount_label text;
begin
  if v_code = '' then
    return public.pb_request_booking(p)::text;
  end if;

  select *
    into v_promo
    from public.pb_promo_codes
    where code = v_code
    for update;

  if not found or not v_promo.is_active then
    raise exception 'That promo code is invalid or inactive.';
  end if;

  select exists (
    select 1
    from jsonb_array_elements_text(coalesce(p->'add_ons', '[]'::jsonb)) as selected(item)
    where lower(selected.item) = lower(v_promo.required_item)
  ) into v_has_required_item;

  if not v_has_required_item then
    raise exception 'Promo code % applies only when % is selected.', v_code, v_promo.required_item;
  end if;

  select count(*)
    into v_used
    from public.pb_promo_redemptions
    where promo_code = v_code;

  if v_used >= v_promo.max_uses then
    raise exception 'Promo code % has reached its booking limit.', v_code;
  end if;

  v_discount := trim(trailing '.' from trim(trailing '0' from v_promo.discount_value::text));
  v_discount_label := case
    when v_promo.discount_type = 'fixed' then format('AED %s off', v_discount)
    else format('%s%% off', v_discount)
  end;
  v_booking_payload := jsonb_set(
    coalesce(p, '{}'::jsonb),
    '{notes}',
    to_jsonb(concat_ws(E'\n',
      nullif(btrim(coalesce(p->>'notes', '')), ''),
      format('Promo code %s applied: %s %s.', v_code, v_discount_label, v_promo.required_item)
    )),
    true
  );

  v_booking_ref := public.pb_request_booking(v_booking_payload)::text;

  insert into public.pb_promo_redemptions (promo_code, booking_ref, discount_type, discount_value, required_item)
  values (v_code, v_booking_ref, v_promo.discount_type, v_promo.discount_value, v_promo.required_item);

  return v_booking_ref;
end;
$$;

revoke all on function public.pb_public_promos() from public;
grant execute on function public.pb_public_promos() to anon, authenticated;

revoke all on function public.pb_admin_promo_stats() from public;
grant execute on function public.pb_admin_promo_stats() to authenticated;

revoke all on function public.pb_request_booking_with_promo(jsonb, text) from public;
grant execute on function public.pb_request_booking_with_promo(jsonb, text) to anon, authenticated;
