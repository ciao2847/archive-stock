begin;

create table public.bundle_claim_orders (
  id bigint generated always as identity primary key,
  owner_id uuid not null
    references public.inventory_databases(id) on delete restrict,
  public_token uuid not null default gen_random_uuid(),
  confirmation_code text not null default (
    'HD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
  ),
  confirmation_request_id uuid null,
  title text not null default '單張大禮包',
  description text null,
  total_amount numeric(12, 2) not null,
  customer_hint text null,
  status text not null default 'draft',
  expires_at timestamptz null,
  customer_nickname text null,
  customer_phone text null,
  customer_phone_normalized text null,
  customer_notes text null,
  confirmed_at timestamptz null,
  receiving_checked_at timestamptz null,
  receiving_checked_by uuid null
    references public.profiles(id) on delete set null,
  outbound_checked_at timestamptz null,
  outbound_checked_by uuid null
    references public.profiles(id) on delete set null,
  created_by uuid null
    references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bundle_claim_orders_public_token_key unique (public_token),
  constraint bundle_claim_orders_confirmation_code_key unique (confirmation_code),
  constraint bundle_claim_orders_confirmation_request_key
    unique (confirmation_request_id),
  constraint bundle_claim_orders_title_length
    check (char_length(btrim(title)) between 1 and 120),
  constraint bundle_claim_orders_description_length
    check (description is null or char_length(description) <= 2000),
  constraint bundle_claim_orders_total_amount_positive
    check (
      total_amount > 0
      and total_amount <= 9999999999.99
      and total_amount = round(total_amount, 2)
    ),
  constraint bundle_claim_orders_customer_hint_length
    check (customer_hint is null or char_length(customer_hint) <= 100),
  constraint bundle_claim_orders_status_allowed
    check (status in ('draft', 'open', 'confirmed', 'cancelled', 'expired')),
  constraint bundle_claim_orders_nickname_length
    check (
      customer_nickname is null
      or char_length(btrim(customer_nickname)) between 1 and 100
    ),
  constraint bundle_claim_orders_phone_length
    check (customer_phone is null or char_length(customer_phone) <= 30),
  constraint bundle_claim_orders_phone_normalized_format
    check (
      customer_phone_normalized is null
      or customer_phone_normalized ~ '^09[0-9]{8}$'
    ),
  constraint bundle_claim_orders_notes_length
    check (customer_notes is null or char_length(customer_notes) <= 1000),
  constraint bundle_claim_orders_confirmation_fields
    check (
      status <> 'confirmed'
      or (
        customer_nickname is not null
        and customer_phone is not null
        and customer_phone_normalized is not null
        and confirmed_at is not null
        and confirmation_request_id is not null
      )
    ),
  constraint bundle_claim_orders_receiving_audit_pair
    check (
      (receiving_checked_at is null and receiving_checked_by is null)
      or (receiving_checked_at is not null and receiving_checked_by is not null)
    ),
  constraint bundle_claim_orders_outbound_audit_pair
    check (
      (outbound_checked_at is null and outbound_checked_by is null)
      or (outbound_checked_at is not null and outbound_checked_by is not null)
    ),
  constraint bundle_claim_orders_outbound_requires_receiving
    check (outbound_checked_at is null or receiving_checked_at is not null)
);

create index bundle_claim_orders_owner_status_created_idx
  on public.bundle_claim_orders(owner_id, status, created_at desc, id desc);
create index bundle_claim_orders_owner_phone_confirmed_idx
  on public.bundle_claim_orders(owner_id, customer_phone_normalized, confirmed_at desc)
  where status = 'confirmed';
create index bundle_claim_orders_expires_at_idx
  on public.bundle_claim_orders(expires_at)
  where status = 'open' and expires_at is not null;
create index bundle_claim_orders_created_by_idx
  on public.bundle_claim_orders(created_by);
create index bundle_claim_orders_receiving_checked_by_idx
  on public.bundle_claim_orders(receiving_checked_by)
  where receiving_checked_by is not null;
create index bundle_claim_orders_outbound_checked_by_idx
  on public.bundle_claim_orders(outbound_checked_by)
  where outbound_checked_by is not null;

create table public.bundle_claim_order_images (
  id bigint generated always as identity primary key,
  order_id bigint not null
    references public.bundle_claim_orders(id) on delete cascade,
  storage_path text not null,
  sort_order integer not null default 0,
  media_type text not null,
  original_filename text not null,
  byte_size bigint not null,
  created_at timestamptz not null default now(),
  constraint bundle_claim_order_images_storage_path_key unique (storage_path),
  constraint bundle_claim_order_images_order_sort_key unique (order_id, sort_order),
  constraint bundle_claim_order_images_storage_path_format
    check (
      storage_path ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9]+/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$'
    ),
  constraint bundle_claim_order_images_sort_order_nonnegative
    check (sort_order >= 0),
  constraint bundle_claim_order_images_media_type_allowed
    check (media_type in ('image/jpeg', 'image/png', 'image/webp')),
  constraint bundle_claim_order_images_filename_length
    check (char_length(btrim(original_filename)) between 1 and 255),
  constraint bundle_claim_order_images_byte_size_range
    check (byte_size between 1 and 8388608)
);

create index bundle_claim_order_images_order_id_idx
  on public.bundle_claim_order_images(order_id, sort_order, id);

create table public.bundle_claim_payments (
  id bigint generated always as identity primary key,
  order_id bigint not null
    references public.bundle_claim_orders(id) on delete restrict,
  amount numeric(12, 2) not null,
  transferred_at timestamptz not null,
  payer_account_last_five text null,
  note text null,
  created_by uuid null
    references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint bundle_claim_payments_order_id_key unique (order_id),
  constraint bundle_claim_payments_amount_positive check (amount > 0),
  constraint bundle_claim_payments_last_five_format
    check (
      payer_account_last_five is null
      or payer_account_last_five ~ '^[0-9]{5}$'
    ),
  constraint bundle_claim_payments_note_length
    check (note is null or char_length(note) <= 1000)
);

create index bundle_claim_payments_created_by_idx
  on public.bundle_claim_payments(created_by);

alter table public.bundle_claim_orders enable row level security;
alter table public.bundle_claim_order_images enable row level security;
alter table public.bundle_claim_payments enable row level security;

revoke all on table public.bundle_claim_orders
  from public, anon, authenticated;
revoke all on table public.bundle_claim_order_images
  from public, anon, authenticated;
revoke all on table public.bundle_claim_payments
  from public, anon, authenticated;

grant select on table public.bundle_claim_orders to authenticated;
grant select on table public.bundle_claim_order_images to authenticated;
grant select on table public.bundle_claim_payments to authenticated;
grant select, insert, update, delete on table public.bundle_claim_orders
  to service_role;
grant select, insert, update, delete on table public.bundle_claim_order_images
  to service_role;
grant select, insert, update, delete on table public.bundle_claim_payments
  to service_role;
grant usage, select on sequence public.bundle_claim_orders_id_seq
  to service_role;
grant usage, select on sequence public.bundle_claim_order_images_id_seq
  to service_role;
grant usage, select on sequence public.bundle_claim_payments_id_seq
  to service_role;

create or replace function private.can_manage_bundle_inventory(
  p_inventory_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.profiles profile
      where profile.id = (select auth.uid())
        and (
          profile.role = 'admin'
          or profile.inventory_owner_id = p_inventory_id
        )
    )
$$;

revoke all on function private.can_manage_bundle_inventory(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.can_manage_bundle_inventory(uuid)
  to authenticated;

create policy "inventory members read bundle claim orders"
on public.bundle_claim_orders for select to authenticated
using ((select private.can_manage_bundle_inventory(owner_id)));

create policy "inventory members read bundle claim images"
on public.bundle_claim_order_images for select to authenticated
using (
  exists (
    select 1
    from public.bundle_claim_orders bundle_order
    where bundle_order.id = bundle_claim_order_images.order_id
      and (select private.can_manage_bundle_inventory(bundle_order.owner_id))
  )
);

create policy "inventory members read bundle claim payments"
on public.bundle_claim_payments for select to authenticated
using (
  exists (
    select 1
    from public.bundle_claim_orders bundle_order
    where bundle_order.id = bundle_claim_payments.order_id
      and (select private.can_manage_bundle_inventory(bundle_order.owner_id))
  )
);

insert into storage.buckets(
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'bundle-claim-screenshots',
  'bundle-claim-screenshots',
  false,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "inventory members read bundle claim screenshots"
  on storage.objects;
create policy "inventory members read bundle claim screenshots"
on storage.objects for select to authenticated
using (
  bucket_id = 'bundle-claim-screenshots'
  and exists (
    select 1
    from public.bundle_claim_orders bundle_order
    where bundle_order.owner_id::text = (storage.foldername(name))[1]
      and bundle_order.id::text = (storage.foldername(name))[2]
      and (select private.can_manage_bundle_inventory(bundle_order.owner_id))
  )
);

drop policy if exists "inventory members upload bundle claim screenshots"
  on storage.objects;
create policy "inventory members upload bundle claim screenshots"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'bundle-claim-screenshots'
  and name ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9]+/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$'
  and exists (
    select 1
    from public.bundle_claim_orders bundle_order
    where bundle_order.owner_id::text = (storage.foldername(name))[1]
      and bundle_order.id::text = (storage.foldername(name))[2]
      and bundle_order.status = 'draft'
      and (select private.can_manage_bundle_inventory(bundle_order.owner_id))
  )
);

drop policy if exists "inventory members delete bundle claim screenshots"
  on storage.objects;
create policy "inventory members delete bundle claim screenshots"
on storage.objects for delete to authenticated
using (
  bucket_id = 'bundle-claim-screenshots'
  and exists (
    select 1
    from public.bundle_claim_orders bundle_order
    where bundle_order.owner_id::text = (storage.foldername(name))[1]
      and bundle_order.id::text = (storage.foldername(name))[2]
      and bundle_order.status = 'draft'
      and (select private.can_manage_bundle_inventory(bundle_order.owner_id))
  )
);

create or replace function private.assert_bundle_inventory_access(
  p_owner_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;
  if p_owner_id is null
    or not (select private.can_manage_bundle_inventory(p_owner_id))
  then
    raise exception 'owner access required';
  end if;
end;
$$;

revoke all on function private.assert_bundle_inventory_access(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.create_bundle_claim_order(
  p_owner_id uuid,
  p_title text,
  p_description text,
  p_total_amount numeric,
  p_customer_hint text,
  p_expires_at timestamptz
)
returns table(order_id bigint, public_token uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text := btrim(coalesce(p_title, ''));
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_customer_hint text := nullif(btrim(coalesce(p_customer_hint, '')), '');
begin
  perform private.assert_bundle_inventory_access(p_owner_id);
  if char_length(v_title) not between 1 and 120 then
    raise exception 'invalid bundle claim title';
  end if;
  if v_description is not null and char_length(v_description) > 2000 then
    raise exception 'invalid bundle claim description';
  end if;
  if p_total_amount is null
    or p_total_amount <= 0
    or p_total_amount > 9999999999.99
    or p_total_amount <> round(p_total_amount, 2)
  then
    raise exception 'invalid bundle claim total';
  end if;
  if v_customer_hint is not null and char_length(v_customer_hint) > 100 then
    raise exception 'invalid bundle claim customer hint';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'invalid bundle claim expiry';
  end if;

  return query
  insert into public.bundle_claim_orders(
    owner_id,
    title,
    description,
    total_amount,
    customer_hint,
    expires_at,
    created_by
  )
  values (
    p_owner_id,
    v_title,
    v_description,
    p_total_amount,
    v_customer_hint,
    p_expires_at,
    (select auth.uid())
  )
  returning bundle_claim_orders.id, bundle_claim_orders.public_token;
end;
$$;

revoke all on function private.create_bundle_claim_order(
  uuid, text, text, numeric, text, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function private.create_bundle_claim_order(
  uuid, text, text, numeric, text, timestamptz
) to authenticated;

create or replace function public.create_bundle_claim_order(
  p_owner_id uuid,
  p_title text,
  p_description text,
  p_total_amount numeric,
  p_customer_hint text,
  p_expires_at timestamptz
)
returns table(order_id bigint, public_token uuid)
language sql
volatile
security invoker
set search_path = ''
as $$
  select *
  from private.create_bundle_claim_order(
    p_owner_id,
    p_title,
    p_description,
    p_total_amount,
    p_customer_hint,
    p_expires_at
  )
$$;

revoke all on function public.create_bundle_claim_order(
  uuid, text, text, numeric, text, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.create_bundle_claim_order(
  uuid, text, text, numeric, text, timestamptz
) to authenticated;

create or replace function private.update_bundle_claim_order_draft(
  p_owner_id uuid,
  p_order_id bigint,
  p_title text,
  p_description text,
  p_total_amount numeric,
  p_customer_hint text,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text := btrim(coalesce(p_title, ''));
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_customer_hint text := nullif(btrim(coalesce(p_customer_hint, '')), '');
begin
  perform private.assert_bundle_inventory_access(p_owner_id);
  if char_length(v_title) not between 1 and 120 then
    raise exception 'invalid bundle claim title';
  end if;
  if v_description is not null and char_length(v_description) > 2000 then
    raise exception 'invalid bundle claim description';
  end if;
  if p_total_amount is null
    or p_total_amount <= 0
    or p_total_amount > 9999999999.99
    or p_total_amount <> round(p_total_amount, 2)
  then
    raise exception 'invalid bundle claim total';
  end if;
  if v_customer_hint is not null and char_length(v_customer_hint) > 100 then
    raise exception 'invalid bundle claim customer hint';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'invalid bundle claim expiry';
  end if;

  update public.bundle_claim_orders bundle_order
  set title = v_title,
      description = v_description,
      total_amount = p_total_amount,
      customer_hint = v_customer_hint,
      expires_at = p_expires_at,
      updated_at = now()
  where bundle_order.id = p_order_id
    and bundle_order.owner_id = p_owner_id
    and bundle_order.status = 'draft';
  if not found then
    raise exception 'bundle claim draft not found';
  end if;
  return true;
end;
$$;

revoke all on function private.update_bundle_claim_order_draft(
  uuid, bigint, text, text, numeric, text, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function private.update_bundle_claim_order_draft(
  uuid, bigint, text, text, numeric, text, timestamptz
) to authenticated;

create or replace function public.update_bundle_claim_order_draft(
  p_owner_id uuid,
  p_order_id bigint,
  p_title text,
  p_description text,
  p_total_amount numeric,
  p_customer_hint text,
  p_expires_at timestamptz
)
returns boolean
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.update_bundle_claim_order_draft(
    p_owner_id,
    p_order_id,
    p_title,
    p_description,
    p_total_amount,
    p_customer_hint,
    p_expires_at
  )
$$;

revoke all on function public.update_bundle_claim_order_draft(
  uuid, bigint, text, text, numeric, text, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.update_bundle_claim_order_draft(
  uuid, bigint, text, text, numeric, text, timestamptz
) to authenticated;

create or replace function private.add_bundle_claim_order_image(
  p_owner_id uuid,
  p_order_id bigint,
  p_storage_path text,
  p_media_type text,
  p_original_filename text,
  p_byte_size bigint
)
returns table(
  image_id bigint,
  sort_order integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.bundle_claim_orders%rowtype;
  v_sort_order integer;
begin
  perform private.assert_bundle_inventory_access(p_owner_id);
  select * into v_order
  from public.bundle_claim_orders bundle_order
  where bundle_order.id = p_order_id
    and bundle_order.owner_id = p_owner_id
  for update;
  if not found or v_order.status <> 'draft' then
    raise exception 'bundle claim draft not found';
  end if;
  if p_storage_path !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9]+/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$'
    or split_part(p_storage_path, '/', 1) <> p_owner_id::text
    or split_part(p_storage_path, '/', 2) <> p_order_id::text
  then
    raise exception 'invalid bundle claim image path';
  end if;
  if p_media_type not in ('image/jpeg', 'image/png', 'image/webp')
    or p_byte_size not between 1 and 8388608
    or char_length(btrim(coalesce(p_original_filename, ''))) not between 1 and 255
  then
    raise exception 'invalid bundle claim image';
  end if;
  if (
    select count(*)
    from public.bundle_claim_order_images image
    where image.order_id = p_order_id
  ) >= 10 then
    raise exception 'bundle claim image limit reached';
  end if;

  select coalesce(max(image.sort_order), -1) + 1
    into v_sort_order
  from public.bundle_claim_order_images image
  where image.order_id = p_order_id;

  return query
  insert into public.bundle_claim_order_images(
    order_id,
    storage_path,
    sort_order,
    media_type,
    original_filename,
    byte_size
  )
  values (
    p_order_id,
    p_storage_path,
    v_sort_order,
    p_media_type,
    btrim(p_original_filename),
    p_byte_size
  )
  returning bundle_claim_order_images.id, bundle_claim_order_images.sort_order;
end;
$$;

revoke all on function private.add_bundle_claim_order_image(
  uuid, bigint, text, text, text, bigint
) from public, anon, authenticated, service_role;
grant execute on function private.add_bundle_claim_order_image(
  uuid, bigint, text, text, text, bigint
) to authenticated;

create or replace function public.add_bundle_claim_order_image(
  p_owner_id uuid,
  p_order_id bigint,
  p_storage_path text,
  p_media_type text,
  p_original_filename text,
  p_byte_size bigint
)
returns table(image_id bigint, sort_order integer)
language sql
volatile
security invoker
set search_path = ''
as $$
  select *
  from private.add_bundle_claim_order_image(
    p_owner_id,
    p_order_id,
    p_storage_path,
    p_media_type,
    p_original_filename,
    p_byte_size
  )
$$;

revoke all on function public.add_bundle_claim_order_image(
  uuid, bigint, text, text, text, bigint
) from public, anon, authenticated, service_role;
grant execute on function public.add_bundle_claim_order_image(
  uuid, bigint, text, text, text, bigint
) to authenticated;

create or replace function private.delete_bundle_claim_order_image(
  p_owner_id uuid,
  p_order_id bigint,
  p_image_id bigint
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_storage_path text;
begin
  perform private.assert_bundle_inventory_access(p_owner_id);
  perform 1
  from public.bundle_claim_orders bundle_order
  where bundle_order.id = p_order_id
    and bundle_order.owner_id = p_owner_id
    and bundle_order.status = 'draft'
  for update;
  if not found then
    raise exception 'bundle claim draft not found';
  end if;

  delete from public.bundle_claim_order_images image
  where image.id = p_image_id
    and image.order_id = p_order_id
  returning image.storage_path into v_storage_path;
  if not found then
    raise exception 'bundle claim image not found';
  end if;
  return v_storage_path;
end;
$$;

revoke all on function private.delete_bundle_claim_order_image(
  uuid, bigint, bigint
) from public, anon, authenticated, service_role;
grant execute on function private.delete_bundle_claim_order_image(
  uuid, bigint, bigint
) to authenticated;

create or replace function public.delete_bundle_claim_order_image(
  p_owner_id uuid,
  p_order_id bigint,
  p_image_id bigint
)
returns text
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.delete_bundle_claim_order_image(
    p_owner_id,
    p_order_id,
    p_image_id
  )
$$;

revoke all on function public.delete_bundle_claim_order_image(
  uuid, bigint, bigint
) from public, anon, authenticated, service_role;
grant execute on function public.delete_bundle_claim_order_image(
  uuid, bigint, bigint
) to authenticated;

create or replace function private.reorder_bundle_claim_order_images(
  p_owner_id uuid,
  p_order_id bigint,
  p_image_ids bigint[]
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected_count integer;
begin
  perform private.assert_bundle_inventory_access(p_owner_id);
  perform 1
  from public.bundle_claim_orders bundle_order
  where bundle_order.id = p_order_id
    and bundle_order.owner_id = p_owner_id
    and bundle_order.status = 'draft'
  for update;
  if not found then
    raise exception 'bundle claim draft not found';
  end if;

  select count(*)::integer into v_expected_count
  from public.bundle_claim_order_images image
  where image.order_id = p_order_id;

  if coalesce(array_length(p_image_ids, 1), 0) <> v_expected_count
    or (
      select count(distinct requested.image_id)
      from unnest(coalesce(p_image_ids, array[]::bigint[])) requested(image_id)
    ) <> v_expected_count
    or exists (
      select 1
      from unnest(coalesce(p_image_ids, array[]::bigint[])) requested(image_id)
      where not exists (
        select 1
        from public.bundle_claim_order_images image
        where image.id = requested.image_id
          and image.order_id = p_order_id
      )
    )
  then
    raise exception 'invalid bundle claim image order';
  end if;

  update public.bundle_claim_order_images image
  set sort_order = image.sort_order + 1000
  where image.order_id = p_order_id;

  update public.bundle_claim_order_images image
  set sort_order = requested.position - 1
  from unnest(p_image_ids) with ordinality requested(image_id, position)
  where image.id = requested.image_id
    and image.order_id = p_order_id;

  return true;
end;
$$;

revoke all on function private.reorder_bundle_claim_order_images(
  uuid, bigint, bigint[]
) from public, anon, authenticated, service_role;
grant execute on function private.reorder_bundle_claim_order_images(
  uuid, bigint, bigint[]
) to authenticated;

create or replace function public.reorder_bundle_claim_order_images(
  p_owner_id uuid,
  p_order_id bigint,
  p_image_ids bigint[]
)
returns boolean
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.reorder_bundle_claim_order_images(
    p_owner_id,
    p_order_id,
    p_image_ids
  )
$$;

revoke all on function public.reorder_bundle_claim_order_images(
  uuid, bigint, bigint[]
) from public, anon, authenticated, service_role;
grant execute on function public.reorder_bundle_claim_order_images(
  uuid, bigint, bigint[]
) to authenticated;

create or replace function private.open_bundle_claim_order(
  p_owner_id uuid,
  p_order_id bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_bundle_inventory_access(p_owner_id);
  update public.bundle_claim_orders bundle_order
  set status = 'open',
      updated_at = now()
  where bundle_order.id = p_order_id
    and bundle_order.owner_id = p_owner_id
    and bundle_order.status = 'draft'
    and (bundle_order.expires_at is null or bundle_order.expires_at > now())
    and exists (
      select 1
      from public.bundle_claim_order_images image
      where image.order_id = bundle_order.id
    );
  if not found then
    raise exception 'bundle claim cannot be opened';
  end if;
  return true;
end;
$$;

revoke all on function private.open_bundle_claim_order(uuid, bigint)
  from public, anon, authenticated, service_role;
grant execute on function private.open_bundle_claim_order(uuid, bigint)
  to authenticated;

create or replace function public.open_bundle_claim_order(
  p_owner_id uuid,
  p_order_id bigint
)
returns boolean
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.open_bundle_claim_order(p_owner_id, p_order_id)
$$;

revoke all on function public.open_bundle_claim_order(uuid, bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.open_bundle_claim_order(uuid, bigint)
  to authenticated;

create or replace function private.revoke_bundle_claim_order(
  p_owner_id uuid,
  p_order_id bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_bundle_inventory_access(p_owner_id);
  update public.bundle_claim_orders bundle_order
  set status = 'cancelled',
      updated_at = now()
  where bundle_order.id = p_order_id
    and bundle_order.owner_id = p_owner_id
    and bundle_order.status = 'open';
  if not found then
    raise exception 'bundle claim cannot be revoked';
  end if;
  return true;
end;
$$;

revoke all on function private.revoke_bundle_claim_order(uuid, bigint)
  from public, anon, authenticated, service_role;
grant execute on function private.revoke_bundle_claim_order(uuid, bigint)
  to authenticated;

create or replace function public.revoke_bundle_claim_order(
  p_owner_id uuid,
  p_order_id bigint
)
returns boolean
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.revoke_bundle_claim_order(p_owner_id, p_order_id)
$$;

revoke all on function public.revoke_bundle_claim_order(uuid, bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.revoke_bundle_claim_order(uuid, bigint)
  to authenticated;

create or replace function public.confirm_bundle_claim_order(
  p_token uuid,
  p_nickname text,
  p_phone text,
  p_notes text,
  p_request_id uuid
)
returns table(
  order_id bigint,
  confirmation_code text,
  submitted_at timestamptz
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_order public.bundle_claim_orders%rowtype;
  v_nickname text := btrim(coalesce(p_nickname, ''));
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
begin
  if session_user not in ('postgres', 'service_role')
    and current_user <> 'service_role'
  then
    raise exception 'service role required';
  end if;
  if char_length(v_nickname) not between 1 and 100 then
    raise exception 'invalid customer nickname';
  end if;
  if v_phone !~ '^09[0-9]{8}$' then
    raise exception 'invalid customer phone';
  end if;
  if v_notes is not null and char_length(v_notes) > 1000 then
    raise exception 'invalid customer notes';
  end if;
  if p_request_id is null then
    raise exception 'invalid request id';
  end if;

  select * into v_order
  from public.bundle_claim_orders bundle_order
  where bundle_order.public_token = p_token
  for update;
  if not found then
    raise exception 'bundle claim not found';
  end if;
  if v_order.status = 'confirmed' then
    return query select
      v_order.id,
      v_order.confirmation_code,
      v_order.confirmed_at;
    return;
  end if;
  if v_order.status <> 'open' then
    raise exception 'bundle claim is unavailable';
  end if;
  if v_order.expires_at is not null and v_order.expires_at <= now() then
    raise exception 'bundle claim is expired';
  end if;

  update public.bundle_claim_orders bundle_order
  set status = 'confirmed',
      confirmation_request_id = p_request_id,
      customer_nickname = v_nickname,
      customer_phone = v_phone,
      customer_phone_normalized = v_phone,
      customer_notes = v_notes,
      confirmed_at = now(),
      updated_at = now()
  where bundle_order.id = v_order.id
  returning bundle_order.id,
            bundle_order.confirmation_code,
            bundle_order.confirmed_at
  into v_order.id, v_order.confirmation_code, v_order.confirmed_at;

  return query select
    v_order.id,
    v_order.confirmation_code,
    v_order.confirmed_at;
end;
$$;

revoke all on function public.confirm_bundle_claim_order(
  uuid, text, text, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.confirm_bundle_claim_order(
  uuid, text, text, text, uuid
) to service_role;

create or replace function private.record_bundle_claim_payment(
  p_owner_id uuid,
  p_order_id bigint,
  p_amount numeric,
  p_transferred_at timestamptz,
  p_payer_account_last_five text,
  p_note text
)
returns table(payment_id bigint, paid_amount numeric)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.bundle_claim_orders%rowtype;
  v_last_five text := nullif(regexp_replace(
    coalesce(p_payer_account_last_five, ''),
    '[^0-9]',
    '',
    'g'
  ), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  perform private.assert_bundle_inventory_access(p_owner_id);
  select * into v_order
  from public.bundle_claim_orders bundle_order
  where bundle_order.id = p_order_id
    and bundle_order.owner_id = p_owner_id
  for update;
  if not found or v_order.status <> 'confirmed' then
    raise exception 'bundle claim confirmation not found';
  end if;
  if p_amount is null or p_amount <> v_order.total_amount then
    raise exception 'bundle claim requires full payment';
  end if;
  if p_transferred_at is null or p_transferred_at > now() + interval '1 day' then
    raise exception 'invalid bundle claim payment time';
  end if;
  if v_last_five is not null and v_last_five !~ '^[0-9]{5}$' then
    raise exception 'invalid payer account last five';
  end if;
  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'bundle claim payment note is too long';
  end if;
  if exists (
    select 1
    from public.bundle_claim_payments payment
    where payment.order_id = p_order_id
  ) then
    raise exception 'bundle claim is already paid';
  end if;

  return query
  insert into public.bundle_claim_payments(
    order_id,
    amount,
    transferred_at,
    payer_account_last_five,
    note,
    created_by
  )
  values (
    p_order_id,
    v_order.total_amount,
    p_transferred_at,
    v_last_five,
    v_note,
    (select auth.uid())
  )
  returning bundle_claim_payments.id, bundle_claim_payments.amount;
end;
$$;

revoke all on function private.record_bundle_claim_payment(
  uuid, bigint, numeric, timestamptz, text, text
) from public, anon, authenticated, service_role;
grant execute on function private.record_bundle_claim_payment(
  uuid, bigint, numeric, timestamptz, text, text
) to authenticated;

create or replace function public.record_bundle_claim_payment(
  p_owner_id uuid,
  p_order_id bigint,
  p_amount numeric,
  p_transferred_at timestamptz,
  p_payer_account_last_five text,
  p_note text
)
returns table(payment_id bigint, paid_amount numeric)
language sql
volatile
security invoker
set search_path = ''
as $$
  select *
  from private.record_bundle_claim_payment(
    p_owner_id,
    p_order_id,
    p_amount,
    p_transferred_at,
    p_payer_account_last_five,
    p_note
  )
$$;

revoke all on function public.record_bundle_claim_payment(
  uuid, bigint, numeric, timestamptz, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.record_bundle_claim_payment(
  uuid, bigint, numeric, timestamptz, text, text
) to authenticated;

create or replace function private.delete_bundle_claim_payment(
  p_owner_id uuid,
  p_order_id bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment_id bigint;
begin
  perform private.assert_bundle_inventory_access(p_owner_id);
  perform 1
  from public.bundle_claim_orders bundle_order
  where bundle_order.id = p_order_id
    and bundle_order.owner_id = p_owner_id
    and bundle_order.status = 'confirmed'
  for update;
  if not found then
    raise exception 'bundle claim confirmation not found';
  end if;

  delete from public.bundle_claim_payments payment
  where payment.order_id = p_order_id
  returning payment.id into v_payment_id;
  if not found then
    raise exception 'bundle claim payment not found';
  end if;
  return v_payment_id;
end;
$$;

revoke all on function private.delete_bundle_claim_payment(uuid, bigint)
  from public, anon, authenticated, service_role;
grant execute on function private.delete_bundle_claim_payment(uuid, bigint)
  to authenticated;

create or replace function public.delete_bundle_claim_payment(
  p_owner_id uuid,
  p_order_id bigint
)
returns bigint
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.delete_bundle_claim_payment(p_owner_id, p_order_id)
$$;

revoke all on function public.delete_bundle_claim_payment(uuid, bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.delete_bundle_claim_payment(uuid, bigint)
  to authenticated;

create or replace function private.set_bundle_claim_receiving_check(
  p_owner_id uuid,
  p_order_id bigint,
  p_checked boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_bundle_inventory_access(p_owner_id);
  if coalesce(p_checked, false) then
    update public.bundle_claim_orders bundle_order
    set receiving_checked_at = coalesce(bundle_order.receiving_checked_at, now()),
        receiving_checked_by = coalesce(
          bundle_order.receiving_checked_by,
          (select auth.uid())
        ),
        updated_at = now()
    where bundle_order.id = p_order_id
      and bundle_order.owner_id = p_owner_id
      and bundle_order.status = 'confirmed';
  else
    update public.bundle_claim_orders bundle_order
    set receiving_checked_at = null,
        receiving_checked_by = null,
        outbound_checked_at = null,
        outbound_checked_by = null,
        updated_at = now()
    where bundle_order.id = p_order_id
      and bundle_order.owner_id = p_owner_id
      and bundle_order.status = 'confirmed';
  end if;
  if not found then
    raise exception 'bundle claim confirmation not found';
  end if;
  return true;
end;
$$;

revoke all on function private.set_bundle_claim_receiving_check(
  uuid, bigint, boolean
) from public, anon, authenticated, service_role;
grant execute on function private.set_bundle_claim_receiving_check(
  uuid, bigint, boolean
) to authenticated;

create or replace function public.set_bundle_claim_receiving_check(
  p_owner_id uuid,
  p_order_id bigint,
  p_checked boolean
)
returns boolean
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.set_bundle_claim_receiving_check(
    p_owner_id,
    p_order_id,
    p_checked
  )
$$;

revoke all on function public.set_bundle_claim_receiving_check(
  uuid, bigint, boolean
) from public, anon, authenticated, service_role;
grant execute on function public.set_bundle_claim_receiving_check(
  uuid, bigint, boolean
) to authenticated;

create or replace function private.set_bundle_claim_outbound_check(
  p_owner_id uuid,
  p_order_id bigint,
  p_checked boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_bundle_inventory_access(p_owner_id);
  if coalesce(p_checked, false) then
    update public.bundle_claim_orders bundle_order
    set outbound_checked_at = coalesce(bundle_order.outbound_checked_at, now()),
        outbound_checked_by = coalesce(
          bundle_order.outbound_checked_by,
          (select auth.uid())
        ),
        updated_at = now()
    where bundle_order.id = p_order_id
      and bundle_order.owner_id = p_owner_id
      and bundle_order.status = 'confirmed'
      and bundle_order.receiving_checked_at is not null;
  else
    update public.bundle_claim_orders bundle_order
    set outbound_checked_at = null,
        outbound_checked_by = null,
        updated_at = now()
    where bundle_order.id = p_order_id
      and bundle_order.owner_id = p_owner_id
      and bundle_order.status = 'confirmed';
  end if;
  if not found then
    raise exception 'bundle claim outbound check is not available';
  end if;
  return true;
end;
$$;

revoke all on function private.set_bundle_claim_outbound_check(
  uuid, bigint, boolean
) from public, anon, authenticated, service_role;
grant execute on function private.set_bundle_claim_outbound_check(
  uuid, bigint, boolean
) to authenticated;

create or replace function public.set_bundle_claim_outbound_check(
  p_owner_id uuid,
  p_order_id bigint,
  p_checked boolean
)
returns boolean
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.set_bundle_claim_outbound_check(
    p_owner_id,
    p_order_id,
    p_checked
  )
$$;

revoke all on function public.set_bundle_claim_outbound_check(
  uuid, bigint, boolean
) from public, anon, authenticated, service_role;
grant execute on function public.set_bundle_claim_outbound_check(
  uuid, bigint, boolean
) to authenticated;

create or replace function private.delete_bundle_claim_order_draft(
  p_owner_id uuid,
  p_order_id bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_bundle_inventory_access(p_owner_id);
  delete from public.bundle_claim_orders bundle_order
  where bundle_order.id = p_order_id
    and bundle_order.owner_id = p_owner_id
    and bundle_order.status = 'draft';
  if not found then
    raise exception 'bundle claim draft not found';
  end if;
  return true;
end;
$$;

revoke all on function private.delete_bundle_claim_order_draft(uuid, bigint)
  from public, anon, authenticated, service_role;
grant execute on function private.delete_bundle_claim_order_draft(uuid, bigint)
  to authenticated;

create or replace function public.delete_bundle_claim_order_draft(
  p_owner_id uuid,
  p_order_id bigint
)
returns boolean
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.delete_bundle_claim_order_draft(p_owner_id, p_order_id)
$$;

revoke all on function public.delete_bundle_claim_order_draft(uuid, bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.delete_bundle_claim_order_draft(uuid, bigint)
  to authenticated;

create or replace function public.query_customer_claims_summary(
  p_phone text,
  p_inventory_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with input as (
    select regexp_replace(
      coalesce(p_phone, ''),
      '[^0-9]',
      '',
      'g'
    ) as normalized_phone
  ),
  inventory as (
    select
      database.id,
      database.name,
      coalesce(database.official_line_id, '') as official_line_id,
      coalesce(database.claim_completion_message, '') as completion_message,
      coalesce(database.claim_transfer_enabled, false) as transfer_enabled,
      coalesce(database.claim_bank_code, '') as bank_code,
      coalesce(database.claim_bank_name, '') as bank_name,
      coalesce(database.claim_bank_branch, '') as bank_branch,
      coalesce(database.claim_bank_account, '') as bank_account
    from public.inventory_databases database
    where database.id = p_inventory_id
  ),
  claim_base as (
    select
      'claim'::text as source_type,
      submission.id,
      submission.nickname,
      submission.payment_status as stored_payment_status,
      submission.confirmation_code,
      submission.created_at,
      form.title as form_title,
      item_totals.total_amount,
      item_totals.items_count,
      item_totals.items_json,
      payment_totals.payment_count,
      payment_totals.total_paid_from_events
    from public.claim_submissions submission
    join public.claim_forms form on form.id = submission.form_id
    cross join lateral (
      select
        coalesce(sum(item.quantity * item.unit_price), 0)::numeric(12, 2)
          as total_amount,
        coalesce(sum(item.quantity), 0)::bigint as items_count,
        coalesce(
          jsonb_agg(
            jsonb_build_object(
              'name', item.product_name,
              'quantity', item.quantity,
              'unit_price', item.unit_price,
              'subtotal', item.quantity * item.unit_price
            ) order by item.id
          ),
          '[]'::jsonb
        ) as items_json
      from public.claim_submission_items item
      where item.submission_id = submission.id
    ) item_totals
    cross join lateral (
      select
        count(payment.id)::integer as payment_count,
        coalesce(sum(payment.amount), 0)::numeric(12, 2)
          as total_paid_from_events
      from public.claim_submission_payments payment
      where payment.submission_id = submission.id
    ) payment_totals
    cross join input
    where form.owner_id = p_inventory_id
      and submission.phone_normalized = input.normalized_phone
  ),
  bundle_base as (
    select
      'bundle'::text as source_type,
      bundle_order.id,
      bundle_order.customer_nickname as nickname,
      case when payment.id is null then 'pending' else 'paid' end
        as stored_payment_status,
      bundle_order.confirmation_code,
      bundle_order.confirmed_at as created_at,
      '單張大禮包喊單'::text as form_title,
      bundle_order.total_amount,
      1::bigint as items_count,
      jsonb_build_array(
        jsonb_build_object(
          'name', bundle_order.title,
          'quantity', 1,
          'unit_price', bundle_order.total_amount,
          'subtotal', bundle_order.total_amount
        )
      ) as items_json,
      case when payment.id is null then 0 else 1 end::integer as payment_count,
      coalesce(payment.amount, 0)::numeric(12, 2) as total_paid_from_events
    from public.bundle_claim_orders bundle_order
    left join public.bundle_claim_payments payment
      on payment.order_id = bundle_order.id
    cross join input
    where bundle_order.owner_id = p_inventory_id
      and bundle_order.status = 'confirmed'
      and bundle_order.customer_phone_normalized = input.normalized_phone
  ),
  entry_base as (
    select * from claim_base
    union all
    select * from bundle_base
  ),
  entry_paid as (
    select
      entry_base.*,
      least(
        entry_base.total_amount,
        case
          when entry_base.payment_count > 0 then
            entry_base.total_paid_from_events
          when entry_base.stored_payment_status = 'paid' then
            entry_base.total_amount
          when entry_base.stored_payment_status = 'half_paid' then
            round(entry_base.total_amount / 2, 2)
          else 0
        end
      )::numeric(12, 2) as paid_amount
    from entry_base
  ),
  entry_scoped as (
    select
      entry_paid.*,
      greatest(entry_paid.total_amount - entry_paid.paid_amount, 0)::numeric(12, 2)
        as outstanding_amount,
      case
        when entry_paid.total_amount > 0
          and entry_paid.paid_amount >= entry_paid.total_amount then 'paid'
        when entry_paid.paid_amount > 0 then 'half_paid'
        else 'pending'
      end as effective_payment_status
    from entry_paid
  ),
  summary as (
    select
      count(entry_scoped.id) as submission_count,
      coalesce(max(entry_scoped.nickname), '') as nickname,
      coalesce(sum(entry_scoped.outstanding_amount), 0) as unsettled_amount,
      coalesce(sum(
        case
          when entry_scoped.outstanding_amount > 0 then entry_scoped.items_count
          else 0
        end
      ), 0) as unsettled_items_count,
      coalesce(sum(entry_scoped.total_amount), 0) as total_amount,
      coalesce(sum(entry_scoped.items_count), 0) as total_items_count,
      count(entry_scoped.id) > 0
        and coalesce(bool_and(entry_scoped.outstanding_amount = 0), false)
        as all_paid,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'source_type', entry_scoped.source_type,
            'form_title', entry_scoped.form_title,
            'confirmation_code', entry_scoped.confirmation_code,
            'payment_status', entry_scoped.effective_payment_status,
            'paid_amount', entry_scoped.paid_amount,
            'outstanding_amount', entry_scoped.outstanding_amount,
            'created_at', entry_scoped.created_at,
            'items', entry_scoped.items_json
          ) order by entry_scoped.created_at desc
        ) filter (where entry_scoped.id is not null),
        '[]'::jsonb
      ) as submissions
    from entry_scoped
  )
  select case
    when input.normalized_phone !~ '^09[0-9]{8}$' then
      jsonb_build_object('valid', false, 'error', 'invalid_phone')
    when p_inventory_id is null or inventory.id is null then
      jsonb_build_object('valid', false, 'error', 'invalid_inventory')
    else jsonb_build_object(
      'valid', true,
      'found', summary.submission_count > 0,
      'phone', input.normalized_phone,
      'nickname', summary.nickname,
      'store_name', inventory.name,
      'official_line_id', inventory.official_line_id,
      'completion_message', inventory.completion_message,
      'transfer_account', case
        when inventory.transfer_enabled
          and nullif(btrim(inventory.bank_account), '') is not null then
          jsonb_build_object(
            'enabled', true,
            'bank_code', inventory.bank_code,
            'bank_name', inventory.bank_name,
            'bank_branch', inventory.bank_branch,
            'account', inventory.bank_account
          )
        else null
      end,
      'unsettled_amount', summary.unsettled_amount,
      'unsettled_items_count', summary.unsettled_items_count,
      'total_amount', summary.total_amount,
      'total_items_count', summary.total_items_count,
      'all_paid', summary.all_paid,
      'submissions', summary.submissions
    )
  end
  from input
  cross join summary
  left join inventory on true
$$;

revoke all on function public.query_customer_claims_summary(text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.query_customer_claims_summary(text, uuid)
  to service_role;

notify pgrst, 'reload schema';

commit;
