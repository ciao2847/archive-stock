begin;

-- Order editing is available to every member of the current inventory. RLS
-- still scopes direct table updates, while this RPC keeps the same scope when
-- it updates the related customer and order-item rows in one transaction.
create or replace function public.update_order_details(
  p_order_id uuid,
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
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_role public.user_role;
  v_inventory_owner_id uuid;
  v_owner_id uuid;
  v_status public.order_status;
  v_customer_id uuid;
  v_item jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;
  select public.my_role() into v_role;
  if v_role not in ('admin', 'staff') then
    raise exception 'employee access required';
  end if;
  select private.current_inventory_owner_id() into v_inventory_owner_id;
  if nullif(trim(p_customer_name), '') is null then
    raise exception 'customer name is required';
  end if;
  if p_payment_status not in ('paid', 'pending') then
    raise exception 'invalid payment status';
  end if;
  if p_sales_channel not in ('direct', 'shopee', 'facebook', 'instagram', 'website', 'other') then
    raise exception 'invalid sales channel';
  end if;
  if p_discount < 0 or p_shipping_income < 0 or p_platform_fee < 0 or p_seller_shipping_cost < 0 then
    raise exception 'financial amounts cannot be negative';
  end if;

  select o.status, o.customer_id, o.owner_id
    into v_status, v_customer_id, v_owner_id
  from public.orders o
  where o.id = p_order_id and o.deleted_at is null
  for update;
  if not found then raise exception 'order not found'; end if;
  if v_role <> 'admin' and v_owner_id <> v_inventory_owner_id then
    raise exception 'owner access required';
  end if;
  if v_status not in ('pending', 'packing') then
    raise exception 'order is locked';
  end if;
  if exists (
    select 1 from public.settlement_orders so where so.order_id = p_order_id
  ) then
    raise exception 'settled order cannot be changed';
  end if;

  update public.customers
  set name = trim(p_customer_name),
      nickname = nullif(trim(p_customer_nickname), ''),
      contact = nullif(trim(p_customer_contact), '')
  where id = v_customer_id;

  update public.orders
  set payment_status = p_payment_status,
      notes = nullif(trim(p_notes), ''),
      sales_channel = coalesce(nullif(trim(p_sales_channel), ''), 'direct'),
      discount = p_discount,
      shipping_income = p_shipping_income,
      platform_fee = p_platform_fee,
      seller_shipping_cost = p_seller_shipping_cost,
      updated_at = now()
  where id = p_order_id;

  for v_item in select value from jsonb_array_elements(p_items) loop
    if (v_item->>'unit_price')::numeric < 0 then
      raise exception 'unit price cannot be negative';
    end if;
    update public.order_items
    set unit_price = (v_item->>'unit_price')::numeric
    where id = (v_item->>'id')::uuid and order_id = p_order_id;
    if not found then raise exception 'order item not found'; end if;
  end loop;
  return true;
end;
$$;

revoke all on function public.update_order_details(uuid,text,text,text,text,text,text,numeric,numeric,numeric,numeric,jsonb)
  from public, anon;
grant execute on function public.update_order_details(uuid,text,text,text,text,text,text,numeric,numeric,numeric,numeric,jsonb)
  to authenticated;

-- Financial fields in the order editor follow the same inventory membership
-- rule as the other order fields. Settled/terminal orders remain locked by
-- update_order_details.
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
  ) and (select public.my_role()) not in ('admin', 'staff') then
    raise exception 'employee access required for financial changes';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_order_financial_update_role() from public, anon, authenticated;

-- Staff can remove orders in their inventory. This function is deliberately
-- security definer because deletion also needs to clean package/scanning and
-- settlement rows that have no public write grants. Every access check is
-- explicit before any row is changed.
create or replace function public.force_delete_order(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.user_role;
  v_inventory_owner_id uuid;
  v_customer_id uuid;
  v_owner_id uuid;
  v_product_ids uuid[];
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;
  select public.my_role() into v_role;
  if v_role not in ('admin', 'staff') then
    raise exception 'employee access required';
  end if;
  select private.current_inventory_owner_id() into v_inventory_owner_id;

  select o.customer_id, o.owner_id
    into v_customer_id, v_owner_id
  from public.orders o
  where o.id = p_order_id
    and (o.owner_id = v_inventory_owner_id or v_role = 'admin')
  for update;
  if not found then raise exception 'order not found'; end if;

  select coalesce(array_agg(distinct oi.product_id), array[]::uuid[])
    into v_product_ids
  from public.order_items oi
  where oi.order_id = p_order_id;

  perform 1
  from public.products p
  where p.id = any(v_product_ids)
  order by p.id
  for update;

  -- `packed_quantity` is the physical quantity already deducted from stock,
  -- including orders that are still partially packed.
  update public.products p
  set stock = p.stock + item.packed_quantity,
      updated_at = now()
  from public.order_items item
  where item.order_id = p_order_id
    and item.product_id = p.id
    and item.packed_quantity > 0;

  delete from public.settlements s
  where exists (
    select 1
    from public.settlement_orders so
    where so.settlement_id = s.id and so.order_id = p_order_id
  );

  update public.product_qr_labels
  set status = 'active', used_order_id = null, used_by = null, used_at = null
  where used_order_id = p_order_id;

  delete from public.packing_package_items
  where order_id = p_order_id;
  delete from public.packing_scans
  where order_id = p_order_id;
  delete from public.order_items
  where order_id = p_order_id;
  delete from public.orders
  where id = p_order_id;

  -- Do not leave an empty resumable package after its last order is removed.
  update public.packing_packages pp
  set status = 'cancelled', updated_at = now()
  where pp.status = 'packing'
    and not exists (
      select 1 from public.packing_package_items ppi
      where ppi.package_id = pp.id
    );

  update public.products p
  set status = case
        when p.stock <= 0 then 'packed'::public.product_status
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
  where p.id = any(v_product_ids);

  if v_customer_id is not null
    and not exists (select 1 from public.orders o where o.customer_id = v_customer_id) then
    delete from public.customers where id = v_customer_id;
  end if;

  return true;
end;
$$;

revoke all on function public.force_delete_order(uuid) from public, anon;
grant execute on function public.force_delete_order(uuid) to authenticated;

-- Keep the legacy soft-archive RPC aligned with the same inventory-member
-- permission and restore any quantity already committed by partial packing.
create or replace function public.archive_order(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.user_role;
  v_inventory_owner_id uuid;
  v_owner_id uuid;
  v_product_ids uuid[];
  v_status public.order_status;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;
  select public.my_role() into v_role;
  if v_role not in ('admin', 'staff') then
    raise exception 'employee access required';
  end if;
  select private.current_inventory_owner_id() into v_inventory_owner_id;

  select o.owner_id, o.status
    into v_owner_id, v_status
  from public.orders o
  where o.id = p_order_id and o.deleted_at is null
    and (o.owner_id = v_inventory_owner_id or v_role = 'admin')
  for update;
  if not found then raise exception 'order not found'; end if;
  if v_status not in ('pending', 'packing') then
    raise exception 'only pending orders can be deleted';
  end if;
  if exists (
    select 1 from public.settlement_orders so where so.order_id = p_order_id
  ) then
    raise exception 'settled order cannot be deleted';
  end if;

  select coalesce(array_agg(distinct oi.product_id), array[]::uuid[])
    into v_product_ids
  from public.order_items oi
  where oi.order_id = p_order_id;

  perform 1
  from public.products p
  where p.id = any(v_product_ids)
  order by p.id
  for update;

  update public.products p
  set stock = p.stock + item.packed_quantity,
      updated_at = now()
  from public.order_items item
  where item.order_id = p_order_id
    and item.product_id = p.id
    and item.packed_quantity > 0;

  update public.product_qr_labels
  set status = 'active', used_order_id = null, used_by = null, used_at = null
  where used_order_id = p_order_id;

  delete from public.packing_package_items
  where order_id = p_order_id;
  delete from public.packing_scans
  where order_id = p_order_id;
  update public.order_items
  set packed_quantity = 0, scanned_quantity = 0
  where order_id = p_order_id;

  update public.orders
  set status = 'cancelled', deleted_at = now(), deleted_by = (select auth.uid()), updated_at = now()
  where id = p_order_id;

  update public.packing_packages pp
  set status = 'cancelled', updated_at = now()
  where pp.status = 'packing'
    and not exists (
      select 1 from public.packing_package_items ppi
      where ppi.package_id = pp.id
    );

  update public.products p
  set status = case
        when p.stock <= 0 then 'packed'::public.product_status
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
  where p.id = any(v_product_ids);

  return true;
end;
$$;

revoke all on function public.archive_order(uuid) from public, anon;
grant execute on function public.archive_order(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
