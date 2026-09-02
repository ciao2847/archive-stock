create or replace function public.complete_order_packing(p_order_id uuid)
returns boolean language plpgsql security invoker set search_path=public as $$
declare v_status public.order_status;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select status into v_status from public.orders where id=p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  if v_status in ('packed','shipped','cancelled') then return false; end if;
  if exists(select 1 from public.order_items where order_id=p_order_id and scanned_quantity<quantity) then raise exception 'not all items have been scanned'; end if;
  if exists(select 1 from public.order_items i join public.products p on p.id=i.product_id where i.order_id=p_order_id and p.stock<i.quantity) then raise exception 'insufficient stock'; end if;
  update public.products p set stock=p.stock-i.quantity,status=case when p.stock-i.quantity=0 then 'packed'::public.product_status else 'in_stock'::public.product_status end,updated_at=now()
  from public.order_items i where i.order_id=p_order_id and p.id=i.product_id;
  update public.orders set status='packed',packed_at=now(),packed_by=auth.uid(),updated_at=now() where id=p_order_id;
  return true;
end $$;

revoke execute on function public.complete_order_packing(uuid) from public, anon;
grant execute on function public.complete_order_packing(uuid) to authenticated;
