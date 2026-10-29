begin;

-- Keep every deletion within the caller's inventory. The existing admin
-- policies continue to allow administrators to manage all inventories.

create policy "inventory members delete products"
on public.products for delete to authenticated
using ((select public.my_role()) = 'staff' and owner_id = (select private.current_inventory_owner_id()));

create policy "inventory members delete settlements"
on public.settlements for delete to authenticated
using ((select public.my_role()) = 'staff' and owner_id = (select private.current_inventory_owner_id()));

create policy "inventory members delete product_qr_labels"
on public.product_qr_labels for delete to authenticated
using ((select public.my_role()) = 'staff' and exists (select 1 from public.products p where p.id = product_qr_labels.product_id and p.owner_id = (select private.current_inventory_owner_id())));

create policy "inventory members delete location_movements"
on public.location_movements for delete to authenticated
using ((select public.my_role()) = 'staff' and exists (select 1 from public.products p where p.id = location_movements.product_id and p.owner_id = (select private.current_inventory_owner_id())));

create policy "inventory members delete packing_scans"
on public.packing_scans for delete to authenticated
using ((select public.my_role()) = 'staff' and exists (select 1 from public.orders o where o.id = packing_scans.order_id and o.owner_id = (select private.current_inventory_owner_id())));

-- Internal order cleanup for product deletion; the public order deletion
-- RPC retains its existing authorization. This helper respects RLS.
create or replace function private.delete_product_order(p_order_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_customer_id uuid;
  v_status public.order_status;
  v_product_ids uuid[];
begin
  if (select auth.uid()) is null
    or coalesce((select public.my_role())::text, '') not in ('admin', 'staff') then
    raise exception 'inventory access required';
  end if;

  select o.customer_id, o.status
  into v_customer_id, v_status
  from public.orders o
  where o.id = p_order_id
    and (o.owner_id = (select private.current_inventory_owner_id())
      or (select public.my_role()) = 'admin')
  for update;

  if not found then raise exception 'order not found'; end if;

  select coalesce(array_agg(distinct oi.product_id), array[]::uuid[])
  into v_product_ids
  from public.order_items oi
  where oi.order_id = p_order_id;

  -- Removing a settlement also removes all of its snapshot links. The other
  -- records from that settlement can then be included in a future settlement.
  delete from public.settlements s
  where s.id in (
    select so.settlement_id
    from public.settlement_orders so
    where so.order_id = p_order_id
  );

  -- Packed/shipped orders already reduced physical stock, so reverse that
  -- movement before the order items disappear.
  if v_status in ('packed', 'shipped') then
    update public.products p
    set stock = p.stock + item.quantity,
        updated_at = now()
    from public.order_items item
    where item.order_id = p_order_id
      and item.product_id = p.id;
  end if;

  update public.product_qr_labels
  set status = 'active', used_order_id = null, used_by = null, used_at = null
  where used_order_id = p_order_id;

  delete from public.packing_scans where order_id = p_order_id;
  delete from public.order_items where order_id = p_order_id;
  delete from public.orders where id = p_order_id;

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
        ) then 'reserved'::public.product_status
        else 'in_stock'::public.product_status
      end,
      updated_at = now()
  where p.id = any(v_product_ids);

  if v_customer_id is not null
    and not exists (
      select 1 from public.orders o where o.customer_id = v_customer_id
    ) then
    delete from public.customers where id = v_customer_id;
  end if;

  return true;
end;
$$;

revoke all on function private.delete_product_order(uuid) from public, anon;
grant execute on function private.delete_product_order(uuid) to authenticated;

create or replace function public.delete_inventory_product(p_product_id uuid)
returns text[]
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_image_paths text[];
  v_order_id uuid;
begin
  if (select auth.uid()) is null
    or coalesce((select public.my_role())::text, '') not in ('admin', 'staff') then
    raise exception 'inventory access required';
  end if;

  select p.image_paths into v_image_paths
  from public.products p
  where p.id = p_product_id
    and (p.owner_id = (select private.current_inventory_owner_id())
      or (select public.my_role()) = 'admin')
  for update;

  if not found then raise exception 'product not found'; end if;

  -- An order is the transaction boundary. If it references this product,
  -- remove the whole order and its packing/settlement history atomically.
  for v_order_id in
    select distinct oi.order_id
    from public.order_items oi
    where oi.product_id = p_product_id
  loop
    perform private.delete_product_order(v_order_id);
  end loop;

  delete from public.settlements s
  where s.id in (
    select sp.settlement_id
    from public.settlement_products sp
    where sp.product_id = p_product_id
  );
  delete from public.packing_scans where product_id = p_product_id;
  delete from public.product_qr_labels where product_id = p_product_id;
  delete from public.location_movements where product_id = p_product_id;
  delete from public.order_items where product_id = p_product_id;
  delete from public.products where id = p_product_id;

  return coalesce(v_image_paths, array[]::text[]);
end;
$$;

revoke all on function public.delete_inventory_product(uuid) from public, anon;
grant execute on function public.delete_inventory_product(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
