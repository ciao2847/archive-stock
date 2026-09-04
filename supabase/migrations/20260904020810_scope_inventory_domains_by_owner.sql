begin;

alter table public.orders
  add column if not exists owner_id uuid references public.profiles(id) on delete restrict;
alter table public.customers
  add column if not exists owner_id uuid references public.profiles(id) on delete restrict;
alter table public.locations
  add column if not exists owner_id uuid references public.profiles(id) on delete restrict;
alter table public.settlements
  add column if not exists owner_id uuid references public.profiles(id) on delete restrict;

update public.orders o
set owner_id = coalesce(
  (select p.owner_id from public.order_items oi join public.products p on p.id = oi.product_id where oi.order_id = o.id limit 1),
  o.created_by,
  (select id from public.profiles order by (role = 'admin') desc, created_at, id limit 1)
)
where o.owner_id is null;

update public.customers c
set owner_id = coalesce(
  (select o.owner_id from public.orders o where o.customer_id = c.id order by o.created_at limit 1),
  c.created_by,
  (select id from public.profiles order by (role = 'admin') desc, created_at, id limit 1)
)
where c.owner_id is null;

update public.locations l
set owner_id = coalesce(
  (select p.owner_id from public.products p where p.location_id = l.id order by p.created_at limit 1),
  (select id from public.profiles order by (role = 'admin') desc, created_at, id limit 1)
)
where l.owner_id is null;

update public.settlements s
set owner_id = coalesce(
  (select o.owner_id from public.settlement_orders so join public.orders o on o.id = so.order_id where so.settlement_id = s.id limit 1),
  s.created_by,
  (select id from public.profiles order by (role = 'admin') desc, created_at, id limit 1)
)
where s.owner_id is null;

do $$
begin
  if exists (select 1 from public.orders where owner_id is null)
    or exists (select 1 from public.customers where owner_id is null)
    or exists (select 1 from public.locations where owner_id is null)
    or exists (select 1 from public.settlements where owner_id is null) then
    raise exception 'cannot assign tenant owners: create at least one profile first';
  end if;
end;
$$;

alter table public.orders alter column owner_id set default auth.uid(), alter column owner_id set not null;
alter table public.customers alter column owner_id set default auth.uid(), alter column owner_id set not null;
alter table public.locations alter column owner_id set default auth.uid(), alter column owner_id set not null;
alter table public.settlements alter column owner_id set default auth.uid(), alter column owner_id set not null;

create index if not exists orders_owner_id_idx on public.orders(owner_id);
create index if not exists customers_owner_id_idx on public.customers(owner_id);
create index if not exists locations_owner_id_idx on public.locations(owner_id);
create index if not exists settlements_owner_id_idx on public.settlements(owner_id);

-- Existing codes remain valid. New locations are unique inside one owner's inventory.
alter table public.locations drop constraint if exists locations_code_key;
create unique index if not exists locations_owner_code_key on public.locations(owner_id, code);

-- If a historical location was shared by multiple owners, create an equivalent
-- owner-local location and repoint each product before RLS hides the relation.
insert into public.locations(owner_id, code, cabinet, shelf, bin, description)
select distinct p.owner_id, l.code, l.cabinet, l.shelf, l.bin, l.description
from public.products p
join public.locations l on l.id = p.location_id
where l.owner_id <> p.owner_id
on conflict (owner_id, code) do nothing;

update public.products p
set location_id = owner_location.id
from public.locations old_location
join public.locations owner_location
  on owner_location.code = old_location.code
where p.location_id = old_location.id
  and owner_location.owner_id = p.owner_id
  and old_location.owner_id <> p.owner_id;

do $$
begin
  if exists (
    select 1
    from public.order_items oi
    join public.products p on p.id = oi.product_id
    join public.orders o on o.id = oi.order_id
    group by o.id
    having count(distinct p.owner_id) > 1
  ) then
    raise exception 'historical order contains products from multiple owners';
  end if;
end;
$$;

create or replace function public.enforce_inventory_owner_consistency()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.location_id is not null and not exists (
    select 1 from public.locations l
    where l.id = new.location_id and l.owner_id = new.owner_id
  ) then
    raise exception 'product and location owners must match';
  end if;
  return new;
end;
$$;
drop trigger if exists enforce_inventory_owner_consistency on public.products;
create trigger enforce_inventory_owner_consistency
before insert or update of owner_id, location_id on public.products
for each row execute function public.enforce_inventory_owner_consistency();
revoke execute on function public.enforce_inventory_owner_consistency() from public, anon, authenticated;

create or replace function public.enforce_order_item_owner_consistency()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if not exists (
    select 1 from public.orders o
    join public.products p on p.owner_id = o.owner_id
    where o.id = new.order_id and p.id = new.product_id
  ) then
    raise exception 'order and product owners must match';
  end if;
  return new;
end;
$$;
drop trigger if exists enforce_order_item_owner_consistency on public.order_items;
create trigger enforce_order_item_owner_consistency
before insert or update of order_id, product_id on public.order_items
for each row execute function public.enforce_order_item_owner_consistency();
revoke execute on function public.enforce_order_item_owner_consistency() from public, anon, authenticated;

drop policy if exists "employees read locations" on public.locations;
drop policy if exists "employees create locations" on public.locations;
drop policy if exists "employees update locations" on public.locations;
drop policy if exists "admins delete locations" on public.locations;
create policy "owners or admins read locations" on public.locations for select to authenticated
using (owner_id = (select auth.uid()) or (select public.my_role()) = 'admin');
create policy "owners or admins create locations" on public.locations for insert to authenticated
with check ((owner_id = (select auth.uid()) and (select public.my_role()) = 'staff') or (select public.my_role()) = 'admin');
create policy "owners or admins update locations" on public.locations for update to authenticated
using (owner_id = (select auth.uid()) or (select public.my_role()) = 'admin')
with check (owner_id = (select auth.uid()) or (select public.my_role()) = 'admin');
create policy "admins delete locations" on public.locations for delete to authenticated
using ((select public.my_role()) = 'admin');

drop policy if exists "employees create movements" on public.location_movements;
drop policy if exists "employees update movements" on public.location_movements;
drop policy if exists "admins delete movements" on public.location_movements;
create policy "product owners or admins read movements" on public.location_movements for select to authenticated
using (exists (select 1 from public.products p where p.id = location_movements.product_id));
create policy "product owners or admins create movements" on public.location_movements for insert to authenticated
with check (exists (select 1 from public.products p where p.id = location_movements.product_id));
create policy "product owners or admins update movements" on public.location_movements for update to authenticated
using (exists (select 1 from public.products p where p.id = location_movements.product_id))
with check (exists (select 1 from public.products p where p.id = location_movements.product_id));
create policy "admins delete movements" on public.location_movements for delete to authenticated
using ((select public.my_role()) = 'admin');

drop policy if exists "employees read customers" on public.customers;
drop policy if exists "employees create customers" on public.customers;
drop policy if exists "employees update customers" on public.customers;
drop policy if exists "admins or creators delete customers" on public.customers;
create policy "owners or admins read customers" on public.customers for select to authenticated
using (owner_id = (select auth.uid()) or (select public.my_role()) = 'admin');
create policy "owners or admins create customers" on public.customers for insert to authenticated
with check (owner_id = (select auth.uid()) or (select public.my_role()) = 'admin');
create policy "owners or admins update customers" on public.customers for update to authenticated
using (owner_id = (select auth.uid()) or (select public.my_role()) = 'admin')
with check (owner_id = (select auth.uid()) or (select public.my_role()) = 'admin');
create policy "owners or admins delete customers" on public.customers for delete to authenticated
using (owner_id = (select auth.uid()) or (select public.my_role()) = 'admin');

drop policy if exists "employees read orders" on public.orders;
drop policy if exists "employees create orders" on public.orders;
drop policy if exists "employees update orders" on public.orders;
drop policy if exists "admins or creators delete orders" on public.orders;
create policy "owners or admins read orders" on public.orders for select to authenticated
using (owner_id = (select auth.uid()) or (select public.my_role()) = 'admin');
create policy "owners or admins create orders" on public.orders for insert to authenticated
with check (owner_id = (select auth.uid()) or (select public.my_role()) = 'admin');
create policy "owners or admins update orders" on public.orders for update to authenticated
using (owner_id = (select auth.uid()) or (select public.my_role()) = 'admin')
with check (owner_id = (select auth.uid()) or (select public.my_role()) = 'admin');
create policy "owners or admins delete orders" on public.orders for delete to authenticated
using (owner_id = (select auth.uid()) or (select public.my_role()) = 'admin');

drop policy if exists "employees read order items" on public.order_items;
drop policy if exists "order creators create items" on public.order_items;
drop policy if exists "employees update order items" on public.order_items;
drop policy if exists "admins or order creators delete items" on public.order_items;
create policy "order owners or admins read items" on public.order_items for select to authenticated
using (exists (select 1 from public.orders o where o.id = order_items.order_id));
create policy "order owners or admins create items" on public.order_items for insert to authenticated
with check (exists (select 1 from public.orders o where o.id = order_items.order_id));
create policy "order owners or admins update items" on public.order_items for update to authenticated
using (exists (select 1 from public.orders o where o.id = order_items.order_id))
with check (exists (select 1 from public.orders o where o.id = order_items.order_id));
create policy "order owners or admins delete items" on public.order_items for delete to authenticated
using (exists (select 1 from public.orders o where o.id = order_items.order_id));

drop policy if exists "employees read packing scans" on public.packing_scans;
drop policy if exists "employees create packing scans" on public.packing_scans;
drop policy if exists "admins update packing scans" on public.packing_scans;
drop policy if exists "admins delete packing scans" on public.packing_scans;
create policy "order owners or admins read packing scans" on public.packing_scans for select to authenticated
using (exists (select 1 from public.orders o where o.id = packing_scans.order_id));
create policy "order owners create packing scans" on public.packing_scans for insert to authenticated
with check (scanned_by = (select auth.uid()) and exists (select 1 from public.orders o where o.id = packing_scans.order_id));
create policy "admins update packing scans" on public.packing_scans for update to authenticated
using ((select public.my_role()) = 'admin') with check ((select public.my_role()) = 'admin');
create policy "admins delete packing scans" on public.packing_scans for delete to authenticated
using ((select public.my_role()) = 'admin');

drop policy if exists "admin reads settlements" on public.settlements;
drop policy if exists "admin reads settlement orders" on public.settlement_orders;
drop policy if exists "admin reads settlement products" on public.settlement_products;
create policy "admins read owner settlements" on public.settlements for select to authenticated
using ((select public.my_role()) = 'admin');
create policy "admins create owner settlements" on public.settlements for insert to authenticated
with check ((select public.my_role()) = 'admin');
create policy "admins read owner settlement orders" on public.settlement_orders for select to authenticated
using ((select public.my_role()) = 'admin' and exists (select 1 from public.settlements s where s.id = settlement_orders.settlement_id));
create policy "admins create owner settlement orders" on public.settlement_orders for insert to authenticated
with check ((select public.my_role()) = 'admin' and exists (select 1 from public.settlements s where s.id = settlement_orders.settlement_id));
create policy "admins read owner settlement products" on public.settlement_products for select to authenticated
using ((select public.my_role()) = 'admin' and exists (select 1 from public.settlements s where s.id = settlement_products.settlement_id));
create policy "admins create owner settlement products" on public.settlement_products for insert to authenticated
with check ((select public.my_role()) = 'admin' and exists (select 1 from public.settlements s where s.id = settlement_products.settlement_id));

-- Products may be created for a selected owner only by an admin. Staff remain
-- locked to auth.uid().
drop policy if exists "owners create products" on public.products;
create policy "owners or admins create products" on public.products for insert to authenticated
with check (
  (owner_id = (select auth.uid()) and (select public.my_role()) = 'staff')
  or (select public.my_role()) = 'admin'
);

drop function if exists public.create_inventory_product(
  text, text, text, text, text, text, integer, numeric, numeric,
  text[], text, text, text[], text
);
create function public.create_inventory_product(
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
  if p_owner_id is null or ((select public.my_role()) <> 'admin' and p_owner_id <> (select auth.uid())) then raise exception 'owner access required'; end if;
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
revoke all on function public.create_inventory_product(text,text,text,text,text,text,integer,numeric,numeric,text[],text,text,text[],text,uuid) from public, anon;
grant execute on function public.create_inventory_product(text,text,text,text,text,text,integer,numeric,numeric,text[],text,text,text[],text,uuid) to authenticated;

create or replace function public.update_inventory_product(
  p_product_id uuid, p_name text, p_category text, p_country text,
  p_source text, p_location text, p_stock integer, p_price numeric,
  p_cost numeric, p_poster_format text, p_poster_size text,
  p_identifying_features text
)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare
  v_location_id uuid; v_existing_stock integer; v_owner_id uuid;
  v_cabinet text; v_shelf integer; v_bin integer;
begin
  if (select public.my_role()) not in ('admin', 'staff') then raise exception 'employee access required'; end if;
  if nullif(trim(p_name), '') is null or p_stock < 0 or p_price < 0 then raise exception 'invalid product data'; end if;
  if p_cost is not null and (p_cost < 0 or (select public.my_role()) <> 'admin') then raise exception 'admin access required for cost'; end if;
  select stock,owner_id into v_existing_stock,v_owner_id from public.products where id=p_product_id for update;
  if not found then raise exception 'product not found'; end if;
  if nullif(trim(p_location), '') is not null then
    select id into v_location_id from public.locations
    where owner_id=v_owner_id and code=upper(trim(p_location));
    if v_location_id is null then
      v_cabinet := split_part(upper(trim(p_location)), '-', 1);
      v_shelf := split_part(upper(trim(p_location)), '-', 2)::integer;
      v_bin := split_part(upper(trim(p_location)), '-', 3)::integer;
      insert into public.locations(owner_id,code,cabinet,shelf,bin)
      values(v_owner_id,upper(trim(p_location)),v_cabinet,v_shelf,v_bin)
      returning id into v_location_id;
    end if;
  end if;
  if p_stock <> v_existing_stock then perform public.adjust_product_stock(p_product_id,p_stock); end if;
  update public.products set name=trim(p_name),category=p_category,
    country=nullif(trim(p_country),''),source=nullif(trim(p_source),''),
    location_id=v_location_id,price=p_price,cost=coalesce(p_cost,cost),
    poster_format=nullif(p_poster_format,''),poster_size=nullif(p_poster_size,''),
    identifying_features=nullif(trim(p_identifying_features),''),updated_at=now()
  where id=p_product_id;
  return true;
end;
$$;

-- Orders inherit their owner from the selected products. Mixing owners in one
-- order is rejected inside the same transaction.
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
  if (select public.my_role()) <> 'admin' and v_owner_id <> (select auth.uid()) then raise exception 'owner access required'; end if;
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

drop function if exists public.create_financial_settlement(date,date);
create function public.create_financial_settlement(p_owner_id uuid, p_start date default null, p_end date default null)
returns public.settlements language plpgsql security invoker set search_path = '' as $$
declare v_settlement public.settlements; v_revenue numeric(14,2); v_cost numeric(14,2);
begin
  if (select auth.uid()) is null or (select public.my_role()) <> 'admin' then raise exception 'admin access required'; end if;
  if not exists(select 1 from public.profiles where id=p_owner_id) then raise exception 'owner not found'; end if;
  select coalesce(sum(x.net_revenue),0) into v_revenue from (
    select o.id,coalesce(sum(oi.quantity*oi.unit_price),0)+o.shipping_income-o.discount-o.platform_fee-o.seller_shipping_cost net_revenue
    from public.orders o join public.order_items oi on oi.order_id=o.id
    where o.owner_id=p_owner_id and o.status in ('packed','shipped')
      and not exists(select 1 from public.settlement_orders so where so.order_id=o.id)
      and (p_start is null or coalesce(o.packed_at,o.created_at)::date>=p_start)
      and (p_end is null or coalesce(o.packed_at,o.created_at)::date<=p_end)
    group by o.id
  ) x;
  select coalesce(sum(coalesce(p.cost,0)),0) into v_cost from public.products p
  where p.owner_id=p_owner_id and not exists(select 1 from public.settlement_products sp where sp.product_id=p.id);
  if v_revenue=0 and v_cost=0 then raise exception 'no unsettled financial data'; end if;
  insert into public.settlements(owner_id,period_start,period_end,revenue,cost,created_by)
  values(p_owner_id,p_start,p_end,v_revenue,v_cost,(select auth.uid())) returning * into v_settlement;
  insert into public.settlement_orders(settlement_id,order_id,revenue)
  select v_settlement.id,o.id,coalesce(sum(oi.quantity*oi.unit_price),0)+o.shipping_income-o.discount-o.platform_fee-o.seller_shipping_cost
  from public.orders o join public.order_items oi on oi.order_id=o.id
  where o.owner_id=p_owner_id and o.status in ('packed','shipped')
    and not exists(select 1 from public.settlement_orders so where so.order_id=o.id)
    and (p_start is null or coalesce(o.packed_at,o.created_at)::date>=p_start)
    and (p_end is null or coalesce(o.packed_at,o.created_at)::date<=p_end)
  group by o.id;
  insert into public.settlement_products(settlement_id,product_id,cost)
  select v_settlement.id,p.id,coalesce(p.cost,0) from public.products p
  where p.owner_id=p_owner_id and not exists(select 1 from public.settlement_products sp where sp.product_id=p.id);
  return v_settlement;
end;
$$;
revoke all on function public.create_financial_settlement(uuid,date,date) from public, anon;
grant execute on function public.create_financial_settlement(uuid,date,date) to authenticated;

notify pgrst, 'reload schema';
commit;
