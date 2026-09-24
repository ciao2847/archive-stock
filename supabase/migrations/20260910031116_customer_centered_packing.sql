begin;

-- Partial packing keeps the original order open until every ordered unit has
-- been packed. `scanned_quantity` is the uncommitted quantity in an open
-- packing package; `packed_quantity` is the quantity already committed to a
-- package and deducted from inventory.
alter table public.order_items
  add column if not exists packed_quantity integer not null default 0;

update public.order_items oi
set
  packed_quantity = case
    when o.status in ('packed', 'shipped') then oi.quantity
    else least(greatest(coalesce(oi.packed_quantity, 0), 0), oi.quantity)
  end,
  scanned_quantity = case
    when o.status in ('packed', 'shipped') then 0
    else least(greatest(coalesce(oi.scanned_quantity, 0), 0), oi.quantity)
  end
from public.orders o
where o.id = oi.order_id;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'order_items_packing_quantities_check'
      and conrelid = 'public.order_items'::regclass
  ) then
    alter table public.order_items
      add constraint order_items_packing_quantities_check
      check (packed_quantity >= 0 and packed_quantity + scanned_quantity <= quantity);
  end if;
end $$;

create index if not exists order_items_packing_progress_idx
  on public.order_items(order_id, product_id, packed_quantity, scanned_quantity);

create sequence if not exists public.packing_package_number_seq start 1;

create table if not exists public.packing_packages (
  id uuid primary key default gen_random_uuid(),
  package_no text not null unique default (
    'PACK-' || lpad(nextval('public.packing_package_number_seq')::text, 6, '0')
  ),
  owner_id uuid not null references public.profiles(id) on delete restrict,
  customer_key text not null check (char_length(trim(customer_key)) between 1 and 512),
  customer_name text not null check (char_length(trim(customer_name)) between 1 and 200),
  status text not null default 'packing'
    check (status in ('packing', 'packed', 'shipped', 'cancelled')),
  created_by uuid not null references public.profiles(id) on delete restrict,
  packed_by uuid references public.profiles(id) on delete restrict,
  packed_at timestamptz,
  shipped_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.packing_package_items (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.packing_packages(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  created_at timestamptz not null default now(),
  unique (package_id, order_item_id)
);

alter table public.packing_scans
  add column if not exists package_id uuid,
  add column if not exists order_item_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'packing_scans_package_id_fkey'
      and conrelid = 'public.packing_scans'::regclass
  ) then
    alter table public.packing_scans
      add constraint packing_scans_package_id_fkey
      foreign key (package_id) references public.packing_packages(id) on delete set null;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'packing_scans_order_item_id_fkey'
      and conrelid = 'public.packing_scans'::regclass
  ) then
    alter table public.packing_scans
      add constraint packing_scans_order_item_id_fkey
      foreign key (order_item_id) references public.order_items(id) on delete set null;
  end if;
end $$;

create index if not exists packing_packages_owner_idx
  on public.packing_packages(owner_id, created_at desc);
create unique index if not exists packing_packages_open_customer_idx
  on public.packing_packages(owner_id, customer_key)
  where status = 'packing';
create index if not exists packing_package_items_package_idx
  on public.packing_package_items(package_id, order_id);
create index if not exists packing_package_items_order_item_idx
  on public.packing_package_items(order_item_id);
create index if not exists packing_scans_package_idx
  on public.packing_scans(package_id, scanned_at desc);

alter table public.packing_packages enable row level security;
alter table public.packing_package_items enable row level security;

revoke all on table public.packing_packages from public, anon;
revoke all on table public.packing_package_items from public, anon;
grant select on table public.packing_packages, public.packing_package_items to authenticated;

drop policy if exists "inventory members read packing packages" on public.packing_packages;
create policy "inventory members read packing packages"
on public.packing_packages for select to authenticated
using (
  owner_id = (select private.current_inventory_owner_id())
  or (select public.my_role()) = 'admin'
);

drop policy if exists "inventory members read packing package items" on public.packing_package_items;
create policy "inventory members read packing package items"
on public.packing_package_items for select to authenticated
using (
  exists (
    select 1
    from public.packing_packages package_row
    where package_row.id = packing_package_items.package_id
      and (
        package_row.owner_id = (select private.current_inventory_owner_id())
        or (select public.my_role()) = 'admin'
      )
  )
);

-- The key is deterministic for the two ways staff identify a customer. A
-- contact value wins because it remains stable when a display name changes;
-- otherwise the normalized name keeps optional nickname fields groupable.
create or replace function public.customer_identity_key(
  p_name text,
  p_nickname text,
  p_contact text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when nullif(btrim(coalesce(p_contact, '')), '') is not null
      then 'contact:' || lower(btrim(p_contact))
    else 'name:' || lower(btrim(coalesce(p_name, '')))
      || '|' || lower(btrim(coalesce(p_nickname, '')))
  end
$$;

revoke all on function public.customer_identity_key(text, text, text)
  from public, anon, authenticated;

-- Start or resume the single open package for this customer and inventory.
create or replace function public.create_packing_package(
  p_owner_id uuid,
  p_customer_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.user_role;
  v_inventory_owner_id uuid;
  v_customer_name text;
  v_package_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;
  select public.my_role() into v_role;
  if v_role not in ('admin', 'staff') then
    raise exception 'employee access required';
  end if;
  if p_owner_id is null or nullif(btrim(p_customer_key), '') is null then
    raise exception 'invalid packing customer';
  end if;
  select private.current_inventory_owner_id()
    into v_inventory_owner_id;
  if v_role <> 'admin' and p_owner_id <> v_inventory_owner_id then
    raise exception 'owner access required';
  end if;
  if not exists (select 1 from public.profiles where id = p_owner_id) then
    raise exception 'owner not found';
  end if;

  select pp.id
  into v_package_id
  from public.packing_packages pp
  where pp.owner_id = p_owner_id
    and pp.customer_key = btrim(p_customer_key)
    and pp.status = 'packing'
  order by pp.created_at desc, pp.id desc
  limit 1
  for update;

  if v_package_id is not null then
    return v_package_id;
  end if;

  select c.name
  into v_customer_name
  from public.orders o
  join public.customers c on c.id = o.customer_id
  join public.order_items oi on oi.order_id = o.id
  where o.owner_id = p_owner_id
    and o.deleted_at is null
    and o.status in ('pending', 'packing')
    and public.customer_identity_key(c.name, c.nickname, c.contact) = btrim(p_customer_key)
    and oi.packed_quantity < oi.quantity
  order by o.created_at, o.id
  limit 1;
  if v_customer_name is null then
    raise exception 'customer has no pending items';
  end if;

  insert into public.packing_packages(
    owner_id, customer_key, customer_name, created_by
  ) values (
    p_owner_id, btrim(p_customer_key), btrim(v_customer_name), (select auth.uid())
  ) returning id into v_package_id;

  -- Adopt scans made by an older order-only client so they can be completed
  -- in the same customer package instead of becoming stranded progress.
  insert into public.packing_package_items(
    package_id, order_id, order_item_id, product_id, quantity
  )
  select
    v_package_id, o.id, oi.id, oi.product_id, oi.scanned_quantity
  from public.orders o
  join public.customers c on c.id = o.customer_id
  join public.order_items oi on oi.order_id = o.id
  where o.owner_id = p_owner_id
    and o.deleted_at is null
    and o.status in ('pending', 'packing')
    and public.customer_identity_key(c.name, c.nickname, c.contact) = btrim(p_customer_key)
    and oi.scanned_quantity > 0
  on conflict (package_id, order_item_id) do nothing;

  return v_package_id;
exception
  when unique_violation then
    select pp.id
    into v_package_id
    from public.packing_packages pp
    where pp.owner_id = p_owner_id
      and pp.customer_key = btrim(p_customer_key)
      and pp.status = 'packing'
    order by pp.created_at desc, pp.id desc
    limit 1;
    if v_package_id is null then raise; end if;
    return v_package_id;
end;
$$;

revoke all on function public.create_packing_package(uuid, text) from public, anon;
grant execute on function public.create_packing_package(uuid, text) to authenticated;

-- Return the live customer package view used by the scanner. It includes all
-- open orders for the person, even when only some items are currently ready.
create or replace function public.get_packing_package_progress(p_package_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_package public.packing_packages%rowtype;
  v_role public.user_role;
  v_inventory_owner_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;
  select public.my_role() into v_role;
  select private.current_inventory_owner_id() into v_inventory_owner_id;
  select * into v_package
  from public.packing_packages pp
  where pp.id = p_package_id
    and (pp.owner_id = v_inventory_owner_id or v_role = 'admin');
  if not found then raise exception 'packing package not found'; end if;

  return jsonb_build_object(
    'id', v_package.id,
    'packageNo', v_package.package_no,
    'ownerId', v_package.owner_id,
    'customerKey', v_package.customer_key,
    'customerName', v_package.customer_name,
    'status', v_package.status,
    'createdAt', v_package.created_at,
    'orders', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'orderId', o.id,
          'orderNo', o.order_no,
          'status', o.status::text,
          'createdAt', o.created_at,
          'items', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'orderItemId', oi.id,
                'productId', oi.product_id,
                'sku', p.sku,
                'name', p.name,
                'quantity', oi.quantity,
                'packedQuantity', oi.packed_quantity,
                'scannedQuantity', oi.scanned_quantity,
                'packageQuantity', coalesce(ppi.quantity, 0)
              ) order by p.sku
            )
            from public.order_items oi
            join public.products p on p.id = oi.product_id
            left join public.packing_package_items ppi
              on ppi.package_id = v_package.id
              and ppi.order_item_id = oi.id
            where oi.order_id = o.id
          ), '[]'::jsonb)
        ) order by o.created_at, o.id
      )
      from public.orders o
      join public.customers c on c.id = o.customer_id
      where o.owner_id = v_package.owner_id
        and o.deleted_at is null
        and public.customer_identity_key(c.name, c.nickname, c.contact) = v_package.customer_key
        and (
          o.status in ('pending', 'packing')
          or exists (
            select 1
            from public.packing_package_items ppi
            where ppi.package_id = v_package.id and ppi.order_id = o.id
          )
        )
    ), '[]'::jsonb),
    'scannedCount', coalesce((
      select sum(ppi.quantity)
      from public.packing_package_items ppi
      where ppi.package_id = v_package.id
    ), 0),
    'orderCount', coalesce((
      select count(distinct ppi.order_id)
      from public.packing_package_items ppi
      where ppi.package_id = v_package.id
    ), 0)
  );
end;
$$;

revoke all on function public.get_packing_package_progress(uuid) from public, anon;
grant execute on function public.get_packing_package_progress(uuid) to authenticated;

-- Shared implementation for QR and manual-SKU scans. It assigns a scanned
-- unit to the oldest outstanding order item for this customer, allowing one
-- package to span many orders while preserving each order's quantities.
create or replace function public.consume_product_for_package(
  p_package_id uuid,
  p_product_id uuid,
  p_scan_method text,
  p_label_id uuid default null
)
returns table(
  valid boolean,
  reason text,
  product_id uuid,
  sku text,
  order_id uuid,
  order_no text,
  order_item_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.user_role;
  v_inventory_owner_id uuid;
  v_package public.packing_packages%rowtype;
  v_product public.products%rowtype;
  v_item public.order_items%rowtype;
  v_order_no text;
  v_label public.product_qr_labels%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'authentication required'; end if;
  select public.my_role() into v_role;
  if v_role not in ('admin', 'staff') then raise exception 'employee access required'; end if;
  select private.current_inventory_owner_id() into v_inventory_owner_id;

  select * into v_package
  from public.packing_packages pp
  where pp.id = p_package_id
    and (pp.owner_id = v_inventory_owner_id or v_role = 'admin')
  for update;
  if not found then
    return query select false, 'package_not_found', p_product_id, null::text,
      null::uuid, null::text, null::uuid;
    return;
  end if;
  if v_package.status <> 'packing' then
    return query select false, 'package_closed', p_product_id, null::text,
      null::uuid, null::text, null::uuid;
    return;
  end if;
  if p_scan_method not in ('qr', 'manual_sku') then
    raise exception 'invalid scan method';
  end if;

  select * into v_product
  from public.products p
  where p.id = p_product_id;
  if not found then
    return query select false, 'invalid_sku', p_product_id, null::text,
      null::uuid, null::text, null::uuid;
    return;
  end if;

  select oi.*
  into v_item
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  join public.customers c on c.id = o.customer_id
  where o.owner_id = v_package.owner_id
    and o.deleted_at is null
    and o.status in ('pending', 'packing')
    and public.customer_identity_key(c.name, c.nickname, c.contact) = v_package.customer_key
    and oi.product_id = p_product_id
    and oi.packed_quantity + oi.scanned_quantity < oi.quantity
  order by o.created_at, o.id, oi.id
  limit 1
  for update of oi, o skip locked;
  if not found then
    return query select false, 'no_customer_item', v_product.id, v_product.sku,
      null::uuid, null::text, null::uuid;
    return;
  end if;
  select o.order_no into v_order_no
  from public.orders o
  where o.id = v_item.order_id;

  if p_label_id is null then
    select * into v_label
    from public.product_qr_labels q
    where q.product_id = p_product_id and q.status = 'active'
    order by q.created_at, q.id
    limit 1
    for update skip locked;
  else
    select * into v_label
    from public.product_qr_labels q
    where q.id = p_label_id
    for update;
    if not found or v_label.product_id <> p_product_id or v_label.status <> 'active' then
      return query select false, 'token_used', v_product.id, v_product.sku,
        v_item.order_id, v_order_no, v_item.id;
      return;
    end if;
  end if;
  if not found then
    return query select false, 'no_active_label', v_product.id, v_product.sku,
      v_item.order_id, v_order_no, v_item.id;
    return;
  end if;

  update public.product_qr_labels
  set status = 'used',
      used_order_id = v_item.order_id,
      used_by = (select auth.uid()),
      used_at = now()
  where id = v_label.id;

  update public.order_items
  set scanned_quantity = scanned_quantity + 1
  where id = v_item.id;

  insert into public.packing_package_items(
    package_id, order_id, order_item_id, product_id, quantity
  ) values (
    v_package.id, v_item.order_id, v_item.id, p_product_id, 1
  )
  on conflict on constraint packing_package_items_package_id_order_item_id_key
  do update set quantity = public.packing_package_items.quantity + 1;

  insert into public.packing_scans(
    order_id, product_id, scanned_by, is_valid, scan_method,
    package_id, order_item_id
  ) values (
    v_item.order_id, p_product_id, (select auth.uid()), true, p_scan_method,
    v_package.id, v_item.id
  );

  return query select true, 'ok', v_product.id, v_product.sku,
    v_item.order_id, v_order_no, v_item.id;
end;
$$;

revoke all on function public.consume_product_for_package(uuid, uuid, text, uuid)
  from public, anon, authenticated;

create or replace function public.consume_product_package_sku(
  p_package_id uuid,
  p_sku text
)
returns table(
  valid boolean,
  reason text,
  product_id uuid,
  sku text,
  order_id uuid,
  order_no text,
  order_item_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare v_product public.products%rowtype;
begin
  select * into v_product
  from public.products p
  where upper(p.sku) = upper(btrim(p_sku));
  if not found then
    return query select false, 'invalid_sku', null::uuid, upper(btrim(p_sku)),
      null::uuid, null::text, null::uuid;
    return;
  end if;
  return query select *
  from public.consume_product_for_package(
    p_package_id, v_product.id, 'manual_sku', null
  );
end;
$$;

revoke all on function public.consume_product_package_sku(uuid, text) from public, anon;
grant execute on function public.consume_product_package_sku(uuid, text) to authenticated;

create or replace function public.consume_product_package_qr(
  p_package_id uuid,
  p_token uuid
)
returns table(
  valid boolean,
  reason text,
  product_id uuid,
  sku text,
  order_id uuid,
  order_no text,
  order_item_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_label public.product_qr_labels%rowtype;
  v_sku text;
begin
  select * into v_label
  from public.product_qr_labels q
  where q.token = p_token;
  if not found then
    return query select false, 'invalid_token', null::uuid, null::text,
      null::uuid, null::text, null::uuid;
    return;
  end if;
  select p.sku into v_sku from public.products p where p.id = v_label.product_id;
  if v_label.status <> 'active' then
    return query select false, 'token_used', v_label.product_id, v_sku,
      null::uuid, null::text, null::uuid;
    return;
  end if;
  return query select *
  from public.consume_product_for_package(
    p_package_id, v_label.product_id, 'qr', v_label.id
  );
end;
$$;

revoke all on function public.consume_product_package_qr(uuid, uuid) from public, anon;
grant execute on function public.consume_product_package_qr(uuid, uuid) to authenticated;

-- Commit only the units scanned in this package. Every affected order is
-- independently marked packed or left open for later arrivals.
create or replace function public.complete_packing_package(p_package_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.user_role;
  v_inventory_owner_id uuid;
  v_package public.packing_packages%rowtype;
  v_scanned_count integer;
  v_order_count integer;
  v_packed_order_count integer;
begin
  if (select auth.uid()) is null then raise exception 'authentication required'; end if;
  select public.my_role() into v_role;
  if v_role not in ('admin', 'staff') then raise exception 'employee access required'; end if;
  select private.current_inventory_owner_id() into v_inventory_owner_id;
  select * into v_package
  from public.packing_packages pp
  where pp.id = p_package_id
    and (pp.owner_id = v_inventory_owner_id or v_role = 'admin')
  for update;
  if not found then raise exception 'packing package not found'; end if;
  if v_package.status in ('packed', 'shipped', 'cancelled') then
    return jsonb_build_object(
      'completed', false,
      'packageNo', v_package.package_no,
      'itemCount', 0,
      'orderCount', 0,
      'fullyPackedOrderCount', 0
    );
  end if;

  select coalesce(sum(ppi.quantity), 0), count(distinct ppi.order_id)
  into v_scanned_count, v_order_count
  from public.packing_package_items ppi
  where ppi.package_id = v_package.id;
  if v_scanned_count = 0 then raise exception 'package has no scanned items'; end if;

  if exists (
    select 1
    from public.packing_package_items ppi
    join public.order_items oi on oi.id = ppi.order_item_id
    where ppi.package_id = v_package.id
      and (
        oi.scanned_quantity < ppi.quantity
        or oi.packed_quantity + ppi.quantity > oi.quantity
      )
  ) then
    raise exception 'packing progress changed, please refresh';
  end if;

  -- Lock products in a deterministic order before checking and decrementing
  -- stock, preventing two staff members from shipping the same unit.
  perform 1
  from public.products p
  where p.id in (
    select ppi.product_id
    from public.packing_package_items ppi
    where ppi.package_id = v_package.id
  )
  order by p.id
  for update;

  if exists (
    select 1
    from public.products p
    join (
      select ppi.product_id, sum(ppi.quantity) as quantity
      from public.packing_package_items ppi
      where ppi.package_id = v_package.id
      group by ppi.product_id
    ) quantities on quantities.product_id = p.id
    where p.stock < quantities.quantity
  ) then
    raise exception 'insufficient stock';
  end if;

  update public.order_items oi
  set packed_quantity = oi.packed_quantity + ppi.quantity,
      scanned_quantity = oi.scanned_quantity - ppi.quantity
  from public.packing_package_items ppi
  where ppi.package_id = v_package.id
    and oi.id = ppi.order_item_id;

  update public.products p
  set stock = p.stock - quantities.quantity,
      status = case
        when p.stock - quantities.quantity = 0
          then 'packed'::public.product_status
        when exists (
          select 1
          from public.order_items oi
          join public.orders o on o.id = oi.order_id
          where oi.product_id = p.id
            and o.deleted_at is null
            and o.status in ('pending', 'packing')
            and oi.packed_quantity < oi.quantity
        ) then 'reserved'::public.product_status
        else 'in_stock'::public.product_status
      end,
      updated_at = now()
  from (
    select ppi.product_id, sum(ppi.quantity) as quantity
    from public.packing_package_items ppi
    where ppi.package_id = v_package.id
    group by ppi.product_id
  ) quantities
  where p.id = quantities.product_id;

  update public.orders o
  set status = case
      when not exists (
        select 1 from public.order_items oi
        where oi.order_id = o.id and oi.packed_quantity < oi.quantity
      ) then 'packed'::public.order_status
      when exists (
        select 1 from public.order_items oi
        where oi.order_id = o.id
          and (oi.packed_quantity > 0 or oi.scanned_quantity > 0)
      ) then 'packing'::public.order_status
      else 'pending'::public.order_status
    end,
    packed_at = case
      when not exists (
        select 1 from public.order_items oi
        where oi.order_id = o.id and oi.packed_quantity < oi.quantity
      ) then coalesce(o.packed_at, now())
      else o.packed_at
    end,
    packed_by = case
      when not exists (
        select 1 from public.order_items oi
        where oi.order_id = o.id and oi.packed_quantity < oi.quantity
      ) then (select auth.uid())
      else o.packed_by
    end,
    updated_at = now()
  where o.id in (
    select ppi.order_id
    from public.packing_package_items ppi
    where ppi.package_id = v_package.id
  );

  select count(*) into v_packed_order_count
  from public.packing_package_items ppi
  join public.orders o on o.id = ppi.order_id
  where ppi.package_id = v_package.id and o.status = 'packed';

  update public.packing_packages
  set status = 'packed', packed_by = (select auth.uid()), packed_at = now(), updated_at = now()
  where id = v_package.id;

  return jsonb_build_object(
    'completed', true,
    'packageNo', v_package.package_no,
    'itemCount', v_scanned_count,
    'orderCount', v_order_count,
    'fullyPackedOrderCount', v_packed_order_count
  );
end;
$$;

revoke all on function public.complete_packing_package(uuid) from public, anon;
grant execute on function public.complete_packing_package(uuid) to authenticated;

-- Keep the legacy one-order endpoint safe for old clients while adopting the
-- new partial-progress column.
create or replace function public.complete_order_packing(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.user_role;
  v_inventory_owner_id uuid;
  v_order public.orders%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'authentication required'; end if;
  select public.my_role() into v_role;
  select private.current_inventory_owner_id() into v_inventory_owner_id;
  select * into v_order
  from public.orders o
  where o.id = p_order_id
    and (o.owner_id = v_inventory_owner_id or v_role = 'admin')
  for update;
  if not found then raise exception 'order not found'; end if;
  if v_order.status in ('packed', 'shipped', 'cancelled') then return false; end if;
  if not exists (select 1 from public.order_items where order_id = p_order_id) then
    raise exception 'order has no items';
  end if;
  if exists (
    select 1 from public.order_items
    where order_id = p_order_id and packed_quantity + scanned_quantity < quantity
  ) then
    raise exception 'not all items have been scanned';
  end if;

  perform 1
  from public.products p
  where p.id in (select product_id from public.order_items where order_id = p_order_id)
  order by p.id
  for update;
  if exists (
    select 1
    from public.products p
    join (
      select product_id, sum(scanned_quantity) as quantity
      from public.order_items
      where order_id = p_order_id
      group by product_id
    ) quantities on quantities.product_id = p.id
    where p.stock < quantities.quantity
  ) then raise exception 'insufficient stock'; end if;

  update public.products p
  set stock = p.stock - quantities.quantity,
      status = case
        when p.stock - quantities.quantity = 0
          then 'packed'::public.product_status
        when exists (
          select 1
          from public.order_items oi
          join public.orders o on o.id = oi.order_id
          where oi.product_id = p.id
            and o.deleted_at is null
            and o.status in ('pending', 'packing')
            and oi.packed_quantity + oi.scanned_quantity < oi.quantity
        ) then 'reserved'::public.product_status
        else 'in_stock'::public.product_status
      end,
      updated_at = now()
  from (
    select product_id, sum(scanned_quantity) as quantity
    from public.order_items
    where order_id = p_order_id
    group by product_id
  ) quantities
  where p.id = quantities.product_id;
  update public.order_items
  set packed_quantity = packed_quantity + scanned_quantity, scanned_quantity = 0
  where order_id = p_order_id;
  update public.orders
  set status = 'packed', packed_at = now(), packed_by = (select auth.uid()), updated_at = now()
  where id = p_order_id;
  return true;
end;
$$;

revoke all on function public.complete_order_packing(uuid) from public, anon;
grant execute on function public.complete_order_packing(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
