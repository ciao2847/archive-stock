begin;

-- A login account and an inventory are separate concepts. Multiple staff
-- accounts may point at the same canonical profile-backed inventory.
alter table public.profiles
  add column if not exists inventory_owner_id uuid
  references public.profiles(id) on delete restrict;

update public.profiles
set inventory_owner_id = id
where inventory_owner_id is null;

alter table public.profiles
  alter column inventory_owner_id set not null;

create index if not exists profiles_inventory_owner_id_idx
  on public.profiles(inventory_owner_id);

-- Preserve the original inventory under Wen. Sheree shares it. Cazzo owns
-- the second inventory and Pennie shares Cazzo's inventory.
do $migration$
declare
  v_wen uuid;
  v_sheree uuid;
  v_cazzo uuid;
  v_pennie uuid;
begin
  select id into v_wen from auth.users where lower(email) = 'a1188358@gmail.com';
  select id into v_sheree from auth.users where lower(email) = 'sheree9068@gmail.com';
  select id into v_cazzo from auth.users where lower(email) = 'cazzo0412@gmail.com';
  select id into v_pennie from auth.users where lower(email) = 'pennie871229@gmail.com';

  if v_wen is null or v_sheree is null or v_cazzo is null or v_pennie is null then
    raise exception 'Create all four Auth users before running this migration';
  end if;

  insert into public.profiles(id, display_name, role, inventory_owner_id)
  values
    (v_wen, 'Wen', 'admin', v_wen),
    (v_sheree, 'Sheree', 'staff', v_wen),
    (v_cazzo, 'Cazzo', 'staff', v_cazzo),
    (v_pennie, 'Pennie', 'staff', v_cazzo)
  on conflict (id) do update set
    display_name = excluded.display_name,
    role = excluded.role,
    inventory_owner_id = excluded.inventory_owner_id;

  create table if not exists public.inventory_databases (
    id uuid primary key default gen_random_uuid(),
    name text not null check (char_length(trim(name)) between 1 and 80),
    created_by uuid not null references public.profiles(id) on delete restrict,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

  create table if not exists public.inventory_database_members (
    inventory_id uuid not null references public.inventory_databases(id) on delete cascade,
    user_id uuid not null references public.profiles(id) on delete cascade,
    is_owner boolean not null default true,
    created_at timestamptz not null default now(),
    primary key (inventory_id, user_id),
    unique (user_id)
  );

  create index if not exists inventory_database_members_user_id_idx
    on public.inventory_database_members(user_id);

  insert into public.inventory_databases(id, name, created_by)
  values
    (v_wen, '海報小天地', v_wen),
    (v_cazzo, 'NN佛系海報', v_wen)
  on conflict (id) do nothing;

  insert into public.inventory_database_members(inventory_id, user_id, is_owner)
  values
    (v_wen, v_wen, true),
    (v_wen, v_sheree, true),
    (v_cazzo, v_cazzo, true),
    (v_cazzo, v_pennie, true)
  on conflict (user_id) do update set
    inventory_id = excluded.inventory_id,
    is_owner = excluded.is_owner;

  -- Consolidate both historical owner IDs into Wen's canonical inventory.
  -- Duplicate location codes are reused before Sheree's locations are removed.
  insert into public.locations(owner_id, code, cabinet, shelf, bin, description)
  select v_wen, code, cabinet, shelf, bin, description
  from public.locations
  where owner_id = v_sheree
  on conflict (owner_id, code) do nothing;

  update public.products p
  set owner_id = v_wen,
      location_id = target.id
  from public.locations source
  join public.locations target
    on target.owner_id = v_wen and target.code = source.code
  where p.owner_id = v_sheree
    and source.id = p.location_id;

  update public.products
  set owner_id = v_wen
  where owner_id = v_sheree and location_id is null;

  update public.orders set owner_id = v_wen where owner_id = v_sheree;
  update public.customers set owner_id = v_wen where owner_id = v_sheree;
  update public.settlements set owner_id = v_wen where owner_id = v_sheree;
  delete from public.locations where owner_id = v_sheree;
end;
$migration$;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.current_inventory_owner_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.inventory_owner_id
  from public.profiles p
  where p.id = (select auth.uid())
$$;

revoke all on function private.current_inventory_owner_id() from public, anon;
grant execute on function private.current_inventory_owner_id() to authenticated;

drop policy if exists "admins read owner settlements" on public.settlements;
drop policy if exists "admins create owner settlements" on public.settlements;
drop policy if exists "inventory members or admins read settlements" on public.settlements;
drop policy if exists "inventory members create owner settlements" on public.settlements;
create policy "inventory members or admins read settlements"
on public.settlements for select to authenticated
using (
  owner_id = (select private.current_inventory_owner_id())
  or (select public.my_role()) = 'admin'
);

create policy "inventory members create owner settlements"
on public.settlements for insert to authenticated
with check (
  owner_id = (select private.current_inventory_owner_id())
  or (select public.my_role()) = 'admin'
);

drop policy if exists "admins read owner settlement orders" on public.settlement_orders;
drop policy if exists "admins create owner settlement orders" on public.settlement_orders;
drop policy if exists "inventory members or admins read settlement orders" on public.settlement_orders;
drop policy if exists "inventory members create owner settlement orders" on public.settlement_orders;
create policy "inventory members or admins read settlement orders"
on public.settlement_orders for select to authenticated
using (
  exists (
    select 1
    from public.settlements s
    where s.id = settlement_orders.settlement_id
      and (
        s.owner_id = (select private.current_inventory_owner_id())
        or (select public.my_role()) = 'admin'
      )
  )
);

create policy "inventory members create owner settlement orders"
on public.settlement_orders for insert to authenticated
with check (
  exists (
    select 1
    from public.settlements s
    where s.id = settlement_orders.settlement_id
      and (
        s.owner_id = (select private.current_inventory_owner_id())
        or (select public.my_role()) = 'admin'
      )
  )
);

drop policy if exists "admins read owner settlement products" on public.settlement_products;
drop policy if exists "admins create owner settlement products" on public.settlement_products;
drop policy if exists "inventory members or admins read settlement products" on public.settlement_products;
drop policy if exists "inventory members create owner settlement products" on public.settlement_products;
create policy "inventory members or admins read settlement products"
on public.settlement_products for select to authenticated
using (
  exists (
    select 1
    from public.settlements s
    where s.id = settlement_products.settlement_id
      and (
        s.owner_id = (select private.current_inventory_owner_id())
        or (select public.my_role()) = 'admin'
      )
  )
);

create policy "inventory members create owner settlement products"
on public.settlement_products for insert to authenticated
with check (
  exists (
    select 1
    from public.settlements s
    where s.id = settlement_products.settlement_id
      and (
        s.owner_id = (select private.current_inventory_owner_id())
        or (select public.my_role()) = 'admin'
      )
  )
);

alter table public.inventory_databases enable row level security;
alter table public.inventory_database_members enable row level security;

revoke all on table public.inventory_databases from public, anon;
revoke all on table public.inventory_database_members from public, anon;
grant select, insert, update, delete on table public.inventory_databases to authenticated;
grant select, insert, update, delete on table public.inventory_database_members to authenticated;

drop policy if exists "members or admins read inventory databases" on public.inventory_databases;
drop policy if exists "admins create inventory databases" on public.inventory_databases;
drop policy if exists "admins update inventory databases" on public.inventory_databases;
drop policy if exists "admins delete inventory databases" on public.inventory_databases;
drop policy if exists "members or admins read inventory memberships" on public.inventory_database_members;
drop policy if exists "admins create inventory memberships" on public.inventory_database_members;
drop policy if exists "admins update inventory memberships" on public.inventory_database_members;
drop policy if exists "admins delete inventory memberships" on public.inventory_database_members;
create policy "members or admins read inventory databases"
on public.inventory_databases for select to authenticated
using (
  id = (select private.current_inventory_owner_id())
  or (select public.my_role()) = 'admin'
);
create policy "admins create inventory databases"
on public.inventory_databases for insert to authenticated
with check ((select public.my_role()) = 'admin');
create policy "admins update inventory databases"
on public.inventory_databases for update to authenticated
using ((select public.my_role()) = 'admin')
with check ((select public.my_role()) = 'admin');
create policy "admins delete inventory databases"
on public.inventory_databases for delete to authenticated
using ((select public.my_role()) = 'admin');

create policy "members or admins read inventory memberships"
on public.inventory_database_members for select to authenticated
using (
  user_id = (select auth.uid())
  or (select public.my_role()) = 'admin'
);
create policy "admins create inventory memberships"
on public.inventory_database_members for insert to authenticated
with check ((select public.my_role()) = 'admin');
create policy "admins update inventory memberships"
on public.inventory_database_members for update to authenticated
using ((select public.my_role()) = 'admin')
with check ((select public.my_role()) = 'admin');
create policy "admins delete inventory memberships"
on public.inventory_database_members for delete to authenticated
using ((select public.my_role()) = 'admin');

drop function if exists public.update_inventory_database_access(uuid, text, uuid[]);
create function public.update_inventory_database_access(
  p_inventory_id uuid,
  p_name text,
  p_owner_ids uuid[]
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select public.my_role()) <> 'admin' then
    raise exception 'admin access required';
  end if;
  if nullif(trim(p_name), '') is null or char_length(trim(p_name)) > 80 then
    raise exception 'invalid inventory database name';
  end if;
  if coalesce(array_length(p_owner_ids, 1), 0) < 1 then
    raise exception 'at least one owner is required';
  end if;
  if exists (
    select 1 from unnest(p_owner_ids) requested_id
    where not exists (select 1 from public.profiles p where p.id = requested_id)
  ) then
    raise exception 'inventory owner not found';
  end if;

  if p_inventory_id is null then
    insert into public.inventory_databases(name, created_by)
    values (trim(p_name), (select auth.uid()))
    returning id into p_inventory_id;
  else
    update public.inventory_databases
    set name = trim(p_name), updated_at = now()
    where id = p_inventory_id;
    if not found then raise exception 'inventory database not found'; end if;
  end if;

  update public.profiles p
  set inventory_owner_id = p.id
  where p.inventory_owner_id = p_inventory_id
    and not exists (
      select 1
      from public.inventory_database_members m
      where m.inventory_id = p_inventory_id
        and m.user_id = p.id
    );

  delete from public.inventory_database_members
  where inventory_id = p_inventory_id
    and user_id <> all(p_owner_ids);

  insert into public.inventory_database_members(inventory_id, user_id, is_owner)
  select p_inventory_id, requested_id, true
  from unnest(p_owner_ids) requested_id
  on conflict (user_id) do update set
    inventory_id = excluded.inventory_id,
    is_owner = true;

  update public.profiles p
  set inventory_owner_id = m.inventory_id
  from public.inventory_database_members m
  where m.user_id = p.id;

  return p_inventory_id;
end;
$$;
revoke all on function public.update_inventory_database_access(uuid,text,uuid[]) from public, anon;
grant execute on function public.update_inventory_database_access(uuid,text,uuid[]) to authenticated;

-- Profiles remain readable only by the current account or an admin.
drop policy if exists "users or admins read profiles" on public.profiles;
create policy "users or admins read profiles"
on public.profiles for select to authenticated
using ((select auth.uid()) = id or (select public.my_role()) = 'admin');

drop policy if exists "owners or admins read products" on public.products;
drop policy if exists "owners or admins create products" on public.products;
drop policy if exists "owners or admins update products" on public.products;
drop policy if exists "inventory members or admins read products" on public.products;
drop policy if exists "inventory members or admins create products" on public.products;
drop policy if exists "inventory members or admins update products" on public.products;
drop policy if exists "admins delete products" on public.products;
create policy "inventory members or admins read products"
on public.products for select to authenticated
using (owner_id = (select private.current_inventory_owner_id()) or (select public.my_role()) = 'admin');
create policy "inventory members or admins create products"
on public.products for insert to authenticated
with check (
  (owner_id = (select private.current_inventory_owner_id()) and (select public.my_role()) = 'staff')
  or (select public.my_role()) = 'admin'
);
create policy "inventory members or admins update products"
on public.products for update to authenticated
using (owner_id = (select private.current_inventory_owner_id()) or (select public.my_role()) = 'admin')
with check (owner_id = (select private.current_inventory_owner_id()) or (select public.my_role()) = 'admin');
create policy "admins delete products"
on public.products for delete to authenticated
using ((select public.my_role()) = 'admin');

drop policy if exists "owners or admins read locations" on public.locations;
drop policy if exists "owners or admins create locations" on public.locations;
drop policy if exists "owners or admins update locations" on public.locations;
drop policy if exists "inventory members or admins read locations" on public.locations;
drop policy if exists "inventory members or admins create locations" on public.locations;
drop policy if exists "inventory members or admins update locations" on public.locations;
drop policy if exists "admins delete locations" on public.locations;
create policy "inventory members or admins read locations" on public.locations for select to authenticated
using (owner_id = (select private.current_inventory_owner_id()) or (select public.my_role()) = 'admin');
create policy "inventory members or admins create locations" on public.locations for insert to authenticated
with check (
  (owner_id = (select private.current_inventory_owner_id()) and (select public.my_role()) = 'staff')
  or (select public.my_role()) = 'admin'
);
create policy "inventory members or admins update locations" on public.locations for update to authenticated
using (owner_id = (select private.current_inventory_owner_id()) or (select public.my_role()) = 'admin')
with check (owner_id = (select private.current_inventory_owner_id()) or (select public.my_role()) = 'admin');
create policy "admins delete locations"
on public.locations for delete to authenticated
using ((select public.my_role()) = 'admin');

drop policy if exists "owners or admins read customers" on public.customers;
drop policy if exists "owners or admins create customers" on public.customers;
drop policy if exists "owners or admins update customers" on public.customers;
drop policy if exists "owners or admins delete customers" on public.customers;
drop policy if exists "inventory members or admins read customers" on public.customers;
drop policy if exists "inventory members or admins create customers" on public.customers;
drop policy if exists "inventory members or admins update customers" on public.customers;
drop policy if exists "inventory members or admins delete customers" on public.customers;
create policy "inventory members or admins read customers" on public.customers for select to authenticated
using (owner_id = (select private.current_inventory_owner_id()) or (select public.my_role()) = 'admin');
create policy "inventory members or admins create customers" on public.customers for insert to authenticated
with check (owner_id = (select private.current_inventory_owner_id()) or (select public.my_role()) = 'admin');
create policy "inventory members or admins update customers" on public.customers for update to authenticated
using (owner_id = (select private.current_inventory_owner_id()) or (select public.my_role()) = 'admin')
with check (owner_id = (select private.current_inventory_owner_id()) or (select public.my_role()) = 'admin');
create policy "inventory members or admins delete customers" on public.customers for delete to authenticated
using (owner_id = (select private.current_inventory_owner_id()) or (select public.my_role()) = 'admin');

drop policy if exists "owners or admins read orders" on public.orders;
drop policy if exists "owners or admins create orders" on public.orders;
drop policy if exists "owners or admins update orders" on public.orders;
drop policy if exists "owners or admins delete orders" on public.orders;
drop policy if exists "inventory members or admins read orders" on public.orders;
drop policy if exists "inventory members or admins create orders" on public.orders;
drop policy if exists "inventory members or admins update orders" on public.orders;
drop policy if exists "inventory members or admins delete orders" on public.orders;
create policy "inventory members or admins read orders" on public.orders for select to authenticated
using (owner_id = (select private.current_inventory_owner_id()) or (select public.my_role()) = 'admin');
create policy "inventory members or admins create orders" on public.orders for insert to authenticated
with check (owner_id = (select private.current_inventory_owner_id()) or (select public.my_role()) = 'admin');
create policy "inventory members or admins update orders" on public.orders for update to authenticated
using (owner_id = (select private.current_inventory_owner_id()) or (select public.my_role()) = 'admin')
with check (owner_id = (select private.current_inventory_owner_id()) or (select public.my_role()) = 'admin');
create policy "inventory members or admins delete orders" on public.orders for delete to authenticated
using (owner_id = (select private.current_inventory_owner_id()) or (select public.my_role()) = 'admin');

create or replace function public.create_inventory_product(
  p_name text, p_work text, p_category text, p_country text, p_source text,
  p_location text, p_stock integer, p_price numeric, p_cost numeric,
  p_image_paths text[], p_poster_format text, p_poster_size text,
  p_poster_crafts text[], p_identifying_features text, p_owner_id uuid
)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_work_id uuid; v_location_id uuid; v_product_id uuid;
  v_cabinet text; v_shelf integer; v_bin integer;
begin
  if (select public.my_role()) not in ('admin', 'staff') then raise exception 'employee access required'; end if;
  if p_owner_id is null or (
    (select public.my_role()) <> 'admin'
    and p_owner_id <> (select private.current_inventory_owner_id())
  ) then raise exception 'owner access required'; end if;
  if nullif(trim(p_name), '') is null or nullif(trim(p_work), '') is null then raise exception 'product and work names are required'; end if;
  if p_stock < 1 or p_stock > 1000 or p_price < 0 or p_cost < 0 then raise exception 'invalid product amount'; end if;
  if p_cost > 0 and (select public.my_role()) <> 'admin' then raise exception 'admin access required for cost'; end if;
  select id into v_work_id from public.works where title_zh = trim(p_work) order by created_at limit 1;
  if v_work_id is null then insert into public.works(title_zh) values(trim(p_work)) returning id into v_work_id; end if;
  select id into v_location_id from public.locations where owner_id = p_owner_id and code = upper(trim(p_location));
  if v_location_id is null then
    v_cabinet := split_part(upper(trim(p_location)), '-', 1);
    v_shelf := split_part(upper(trim(p_location)), '-', 2)::integer;
    v_bin := split_part(upper(trim(p_location)), '-', 3)::integer;
    insert into public.locations(owner_id, code, cabinet, shelf, bin)
    values(p_owner_id, upper(trim(p_location)), v_cabinet, v_shelf, v_bin) returning id into v_location_id;
  end if;
  insert into public.products(
    owner_id, name, category, work_id, country, source, location_id, stock, price,
    cost, image_paths, poster_format, poster_size, poster_crafts,
    identifying_features, created_by
  ) values (
    p_owner_id, trim(p_name), p_category, v_work_id, nullif(trim(p_country), ''),
    nullif(trim(p_source), ''), v_location_id, p_stock, p_price, p_cost,
    coalesce(p_image_paths, '{}'), nullif(p_poster_format, ''),
    nullif(p_poster_size, ''), coalesce(p_poster_crafts, '{}'),
    nullif(trim(p_identifying_features), ''), (select auth.uid())
  ) returning id into v_product_id;
  insert into public.product_qr_labels(product_id, batch_code)
  select v_product_id, to_char(current_date, 'YYYYMMDD') from generate_series(1, p_stock);
  return v_product_id;
end;
$$;

create or replace function public.create_order_with_items(
  p_customer_name text, p_customer_nickname text, p_customer_contact text,
  p_payment_status text, p_notes text, p_sales_channel text, p_discount numeric,
  p_shipping_income numeric, p_platform_fee numeric, p_seller_shipping_cost numeric,
  p_items jsonb
)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_customer_id uuid; v_order_id uuid; v_item jsonb; v_product_id uuid;
  v_quantity integer; v_unit_price numeric; v_product_stock integer;
  v_product_status public.product_status; v_owner_id uuid; v_item_owner_id uuid;
begin
  if (select public.my_role()) not in ('admin', 'staff') then raise exception 'employee access required'; end if;
  if nullif(trim(p_customer_name), '') is null then raise exception 'customer name is required'; end if;
  if p_payment_status not in ('paid', 'pending') then raise exception 'invalid payment status'; end if;
  if coalesce(nullif(trim(p_sales_channel), ''), 'direct') not in ('direct','shopee','facebook','instagram','website','other') then raise exception 'invalid sales channel'; end if;
  if p_discount < 0 or p_shipping_income < 0 or p_platform_fee < 0 or p_seller_shipping_cost < 0 then raise exception 'financial amounts cannot be negative'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 100 then raise exception 'order items must contain between 1 and 100 entries'; end if;
  if (select count(*) <> count(distinct item->>'product_id') from jsonb_array_elements(p_items) item) then raise exception 'duplicate products are not allowed'; end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    begin
      v_product_id := (v_item->>'product_id')::uuid;
      v_quantity := (v_item->>'quantity')::integer;
      v_unit_price := (v_item->>'unit_price')::numeric;
    exception when others then raise exception 'invalid order item'; end;
    if v_quantity < 1 or v_unit_price < 0 then raise exception 'invalid order item'; end if;
    select stock, status, owner_id into v_product_stock, v_product_status, v_item_owner_id
    from public.products where id = v_product_id for update;
    if not found then raise exception 'product not found'; end if;
    if v_owner_id is null then v_owner_id := v_item_owner_id;
    elsif v_owner_id <> v_item_owner_id then raise exception 'mixed product owners are not allowed'; end if;
    if v_product_status <> 'in_stock' or v_product_stock < v_quantity then raise exception 'product is not available'; end if;
  end loop;
  if (select public.my_role()) <> 'admin'
    and v_owner_id <> (select private.current_inventory_owner_id()) then
    raise exception 'owner access required';
  end if;
  insert into public.customers(owner_id,name,nickname,contact,created_by)
  values(v_owner_id,trim(p_customer_name),nullif(trim(p_customer_nickname),''),nullif(trim(p_customer_contact),''),(select auth.uid()))
  returning id into v_customer_id;
  insert into public.orders(owner_id,customer_id,payment_status,status,notes,sales_channel,discount,shipping_income,platform_fee,seller_shipping_cost,created_by)
  values(v_owner_id,v_customer_id,p_payment_status,'pending',nullif(trim(p_notes),''),coalesce(nullif(trim(p_sales_channel),''),'direct'),p_discount,p_shipping_income,p_platform_fee,p_seller_shipping_cost,(select auth.uid()))
  returning id into v_order_id;
  for v_item in select value from jsonb_array_elements(p_items) loop
    insert into public.order_items(order_id,product_id,quantity,unit_price)
    values(v_order_id,(v_item->>'product_id')::uuid,(v_item->>'quantity')::integer,(v_item->>'unit_price')::numeric);
  end loop;
  update public.products set status='reserved',updated_at=now()
  where id in (select (item->>'product_id')::uuid from jsonb_array_elements(p_items) item);
  return v_order_id;
end;
$$;

notify pgrst, 'reload schema';
commit;
