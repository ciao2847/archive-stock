begin;

-- Record who created mutable business records so destructive operations can be
-- limited to the creator or an administrator.
alter table public.customers
  add column if not exists created_by uuid references public.profiles(id)
  default auth.uid();

alter table public.orders
  add column if not exists created_by uuid references public.profiles(id)
  default auth.uid();

alter table public.products
  alter column created_by set default auth.uid();

create index if not exists customers_created_by_idx
  on public.customers(created_by);
create index if not exists orders_created_by_idx
  on public.orders(created_by);
create index if not exists products_created_by_idx
  on public.products(created_by);

-- Replace broad authenticated policies with explicit employee-role checks.
drop policy if exists "team manages works" on public.works;
create policy "employees create works" on public.works
  for insert to authenticated
  with check ((select public.my_role()) in ('admin', 'staff'));
create policy "employees update works" on public.works
  for update to authenticated
  using ((select public.my_role()) in ('admin', 'staff'))
  with check ((select public.my_role()) in ('admin', 'staff'));
create policy "admins delete works" on public.works
  for delete to authenticated
  using ((select public.my_role()) = 'admin');

drop policy if exists "team manages locations" on public.locations;
create policy "employees create locations" on public.locations
  for insert to authenticated
  with check ((select public.my_role()) in ('admin', 'staff'));
create policy "employees update locations" on public.locations
  for update to authenticated
  using ((select public.my_role()) in ('admin', 'staff'))
  with check ((select public.my_role()) in ('admin', 'staff'));
create policy "admins delete locations" on public.locations
  for delete to authenticated
  using ((select public.my_role()) = 'admin');

drop policy if exists "team creates products" on public.products;
drop policy if exists "team updates products" on public.products;
drop policy if exists "admin deletes products" on public.products;
create policy "employees create products" on public.products
  for insert to authenticated
  with check (
    (select public.my_role()) in ('admin', 'staff')
    and created_by = (select auth.uid())
  );
create policy "employees update products" on public.products
  for update to authenticated
  using ((select public.my_role()) in ('admin', 'staff'))
  with check ((select public.my_role()) in ('admin', 'staff'));
create policy "admins delete products" on public.products
  for delete to authenticated
  using ((select public.my_role()) = 'admin');

drop policy if exists "team movements" on public.location_movements;
create policy "employees create movements" on public.location_movements
  for insert to authenticated
  with check ((select public.my_role()) in ('admin', 'staff'));
create policy "employees update movements" on public.location_movements
  for update to authenticated
  using ((select public.my_role()) in ('admin', 'staff'))
  with check ((select public.my_role()) in ('admin', 'staff'));
create policy "admins delete movements" on public.location_movements
  for delete to authenticated
  using ((select public.my_role()) = 'admin');

drop policy if exists "team customers" on public.customers;
create policy "employees read customers" on public.customers
  for select to authenticated
  using ((select public.my_role()) in ('admin', 'staff'));
create policy "employees create customers" on public.customers
  for insert to authenticated
  with check (
    (select public.my_role()) in ('admin', 'staff')
    and created_by = (select auth.uid())
  );
create policy "employees update customers" on public.customers
  for update to authenticated
  using ((select public.my_role()) in ('admin', 'staff'))
  with check ((select public.my_role()) in ('admin', 'staff'));
create policy "admins or creators delete customers" on public.customers
  for delete to authenticated
  using (
    (select public.my_role()) = 'admin'
    or created_by = (select auth.uid())
  );

drop policy if exists "team orders" on public.orders;
create policy "employees read orders" on public.orders
  for select to authenticated
  using ((select public.my_role()) in ('admin', 'staff'));
create policy "employees create orders" on public.orders
  for insert to authenticated
  with check (
    (select public.my_role()) in ('admin', 'staff')
    and created_by = (select auth.uid())
  );
create policy "employees update orders" on public.orders
  for update to authenticated
  using ((select public.my_role()) in ('admin', 'staff'))
  with check ((select public.my_role()) in ('admin', 'staff'));
create policy "admins or creators delete orders" on public.orders
  for delete to authenticated
  using (
    (select public.my_role()) = 'admin'
    or created_by = (select auth.uid())
  );

drop policy if exists "team order items" on public.order_items;
create policy "employees read order items" on public.order_items
  for select to authenticated
  using ((select public.my_role()) in ('admin', 'staff'));
create policy "order creators create items" on public.order_items
  for insert to authenticated
  with check (
    (select public.my_role()) in ('admin', 'staff')
    and exists (
      select 1 from public.orders
      where orders.id = order_items.order_id
        and orders.created_by = (select auth.uid())
    )
  );
create policy "employees update order items" on public.order_items
  for update to authenticated
  using ((select public.my_role()) in ('admin', 'staff'))
  with check ((select public.my_role()) in ('admin', 'staff'));
create policy "admins or order creators delete items" on public.order_items
  for delete to authenticated
  using (
    (select public.my_role()) = 'admin'
    or exists (
      select 1 from public.orders
      where orders.id = order_items.order_id
        and orders.created_by = (select auth.uid())
    )
  );

drop policy if exists "team packing scans" on public.packing_scans;
create policy "employees read packing scans" on public.packing_scans
  for select to authenticated
  using ((select public.my_role()) in ('admin', 'staff'));
create policy "employees create packing scans" on public.packing_scans
  for insert to authenticated
  with check (
    (select public.my_role()) in ('admin', 'staff')
    and scanned_by = (select auth.uid())
  );
create policy "admins update packing scans" on public.packing_scans
  for update to authenticated
  using ((select public.my_role()) = 'admin')
  with check ((select public.my_role()) = 'admin');
create policy "admins delete packing scans" on public.packing_scans
  for delete to authenticated
  using ((select public.my_role()) = 'admin');

drop policy if exists "team creates qr labels" on public.product_qr_labels;
drop policy if exists "team updates qr labels" on public.product_qr_labels;
create policy "employees create qr labels" on public.product_qr_labels
  for insert to authenticated
  with check ((select public.my_role()) in ('admin', 'staff'));
create policy "employees update qr labels" on public.product_qr_labels
  for update to authenticated
  using ((select public.my_role()) in ('admin', 'staff'))
  with check ((select public.my_role()) in ('admin', 'staff'));

drop policy if exists "team uploads product images" on storage.objects;
drop policy if exists "admin deletes product images" on storage.objects;
create policy "employees upload product images" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'product-images'
    and (select public.my_role()) in ('admin', 'staff')
  );
create policy "admins delete product images" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'product-images'
    and (select public.my_role()) = 'admin'
  );

-- Staff can record amounts while creating an order, but only admins may alter
-- financial totals after the order exists.
create or replace function public.enforce_order_financial_update_role()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (
    new.discount,
    new.shipping_income,
    new.platform_fee,
    new.seller_shipping_cost
  ) is distinct from (
    old.discount,
    old.shipping_income,
    old.platform_fee,
    old.seller_shipping_cost
  ) and (select public.my_role()) is distinct from 'admin'::public.user_role then
    raise exception 'admin access required for financial changes';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_order_financial_update_role on public.orders;
create trigger enforce_order_financial_update_role
before update on public.orders
for each row execute function public.enforce_order_financial_update_role();

revoke execute on function public.enforce_order_financial_update_role()
  from public, anon, authenticated;

create or replace function public.create_order_with_items(
  p_customer_name text,
  p_customer_nickname text,
  p_customer_contact text,
  p_payment_status text,
  p_notes text,
  p_sales_channel text,
  p_discount numeric,
  p_shipping_income numeric,
  p_platform_fee numeric,
  p_seller_shipping_cost numeric,
  p_items jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_customer_id uuid;
  v_order_id uuid;
  v_item jsonb;
  v_product_id uuid;
  v_quantity integer;
  v_unit_price numeric;
  v_product_stock integer;
  v_product_status public.product_status;
begin
  if auth.uid() is null
    or public.my_role() is null
    or public.my_role() not in ('admin', 'staff') then
    raise exception 'employee access required';
  end if;

  if nullif(trim(p_customer_name), '') is null then
    raise exception 'customer name is required';
  end if;
  if p_payment_status not in ('paid', 'pending') then
    raise exception 'invalid payment status';
  end if;
  if coalesce(nullif(trim(p_sales_channel), ''), 'direct') not in
    ('direct', 'shopee', 'facebook', 'instagram', 'website', 'other') then
    raise exception 'invalid sales channel';
  end if;
  if p_discount < 0 or p_shipping_income < 0
    or p_platform_fee < 0 or p_seller_shipping_cost < 0 then
    raise exception 'financial amounts cannot be negative';
  end if;
  if jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) < 1
    or jsonb_array_length(p_items) > 100 then
    raise exception 'order items must contain between 1 and 100 entries';
  end if;
  if (
    select count(*) <> count(distinct item->>'product_id')
    from jsonb_array_elements(p_items) as item
  ) then
    raise exception 'duplicate products are not allowed';
  end if;

  -- Validate and lock every product before writing any business record. The
  -- function call is one database transaction, so any later error rolls back.
  for v_item in select value from jsonb_array_elements(p_items) loop
    begin
      v_product_id := (v_item->>'product_id')::uuid;
      v_quantity := (v_item->>'quantity')::integer;
      v_unit_price := (v_item->>'unit_price')::numeric;
    exception when others then
      raise exception 'invalid order item';
    end;

    if v_quantity < 1 or v_unit_price < 0 then
      raise exception 'invalid order item';
    end if;

    select stock, status
      into v_product_stock, v_product_status
    from public.products
    where id = v_product_id
    for update;

    if not found then raise exception 'product not found'; end if;
    if v_product_status <> 'in_stock' or v_product_stock < v_quantity then
      raise exception 'product is not available';
    end if;
  end loop;

  insert into public.customers(name, nickname, contact, created_by)
  values (
    trim(p_customer_name),
    nullif(trim(p_customer_nickname), ''),
    nullif(trim(p_customer_contact), ''),
    auth.uid()
  )
  returning id into v_customer_id;

  insert into public.orders(
    customer_id,
    payment_status,
    status,
    notes,
    sales_channel,
    discount,
    shipping_income,
    platform_fee,
    seller_shipping_cost,
    created_by
  )
  values (
    v_customer_id,
    p_payment_status,
    'pending',
    nullif(trim(p_notes), ''),
    coalesce(nullif(trim(p_sales_channel), ''), 'direct'),
    p_discount,
    p_shipping_income,
    p_platform_fee,
    p_seller_shipping_cost,
    auth.uid()
  )
  returning id into v_order_id;

  for v_item in select value from jsonb_array_elements(p_items) loop
    insert into public.order_items(order_id, product_id, quantity, unit_price)
    values (
      v_order_id,
      (v_item->>'product_id')::uuid,
      (v_item->>'quantity')::integer,
      (v_item->>'unit_price')::numeric
    );
  end loop;

  update public.products
  set status = 'reserved', updated_at = now()
  where id in (
    select (item->>'product_id')::uuid
    from jsonb_array_elements(p_items) as item
  );

  return v_order_id;
end;
$$;

revoke execute on function public.create_order_with_items(
  text, text, text, text, text, text,
  numeric, numeric, numeric, numeric, jsonb
) from public, anon;
grant execute on function public.create_order_with_items(
  text, text, text, text, text, text,
  numeric, numeric, numeric, numeric, jsonb
) to authenticated;

notify pgrst, 'reload schema';

commit;
