drop function if exists public.complete_order_packing(uuid);

create function public.complete_order_packing(p_order_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_status public.order_status;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  select o.status
  into v_status
  from public.orders o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'order not found';
  end if;

  if v_status in ('packed', 'shipped', 'cancelled') then
    return false;
  end if;

  if not exists (
    select 1
    from public.order_items oi
    where oi.order_id = p_order_id
  ) then
    raise exception 'order has no items';
  end if;

  if exists (
    select 1
    from public.order_items oi
    where oi.order_id = p_order_id
      and oi.scanned_quantity < oi.quantity
  ) then
    raise exception 'not all items have been scanned';
  end if;

  perform p.id
  from public.products p
  join public.order_items oi on oi.product_id = p.id
  where oi.order_id = p_order_id
  order by p.id
  for update of p;

  if exists (
    select 1
    from public.order_items oi
    join public.products p on p.id = oi.product_id
    where oi.order_id = p_order_id
      and p.stock < oi.quantity
  ) then
    raise exception 'insufficient stock';
  end if;

  update public.products p
  set stock = p.stock - oi.quantity,
      status = case
        when p.stock - oi.quantity = 0
          then 'packed'::public.product_status
        else 'in_stock'::public.product_status
      end,
      updated_at = now()
  from public.order_items oi
  where oi.order_id = p_order_id
    and p.id = oi.product_id;

  update public.orders
  set status = 'packed',
      packed_at = now(),
      packed_by = auth.uid(),
      updated_at = now()
  where id = p_order_id;

  return true;
end $$;

revoke execute on function public.complete_order_packing(uuid) from public, anon;
grant execute on function public.complete_order_packing(uuid) to authenticated;

notify pgrst, 'reload schema';

select
  to_regprocedure('public.complete_order_packing(uuid)') is not null
  and has_function_privilege(
    'authenticated',
    'public.complete_order_packing(uuid)',
    'execute'
  ) as complete_order_packing_ready;
