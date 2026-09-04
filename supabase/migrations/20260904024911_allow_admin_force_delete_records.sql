begin;

-- These policies do not broaden access to staff. They only let the admin-only
-- invoker RPC remove dependent history inside one transaction.
drop policy if exists "admins delete qr labels" on public.product_qr_labels;
create policy "admins delete qr labels"
on public.product_qr_labels for delete to authenticated
using ((select public.my_role()) = 'admin');

drop policy if exists "admins delete settlements" on public.settlements;
create policy "admins delete settlements"
on public.settlements for delete to authenticated
using ((select public.my_role()) = 'admin');

create or replace function public.force_delete_order(p_order_id uuid)
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
    or (select public.my_role()) <> 'admin' then
    raise exception 'admin access required';
  end if;

  select o.customer_id, o.status
  into v_customer_id, v_status
  from public.orders o
  where o.id = p_order_id
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

revoke all on function public.force_delete_order(uuid) from public, anon;
grant execute on function public.force_delete_order(uuid) to authenticated;

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
    or (select public.my_role()) <> 'admin' then
    raise exception 'admin access required';
  end if;

  select p.image_paths into v_image_paths
  from public.products p
  where p.id = p_product_id
  for update;

  if not found then raise exception 'product not found'; end if;

  -- An order is the transaction boundary. If it references this product,
  -- remove the whole order and its packing/settlement history atomically.
  for v_order_id in
    select distinct oi.order_id
    from public.order_items oi
    where oi.product_id = p_product_id
  loop
    perform public.force_delete_order(v_order_id);
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
