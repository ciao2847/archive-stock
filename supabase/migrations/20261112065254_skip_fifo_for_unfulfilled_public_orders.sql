begin;

-- Public submit RPCs already validate form tokens and project pending orders.
-- Reconcile costs only when fulfillment can change, retaining the manager-only
-- checks in sync_product_fifo and all existing table/RPC grants.
create or replace function private.sync_fifo_trigger() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  if tg_table_name='products' then
    if tg_op='UPDATE' and new.stock is not distinct from old.stock and new.owner_id is not distinct from old.owner_id then return null; end if;
    perform private.sync_product_fifo(new.id);
  elsif tg_table_name='order_items' then
    if tg_op<>'INSERT' then
      if old.packed_quantity>0 or exists(select 1 from public.inventory_cost_allocations where order_item_id=old.id) then
        perform private.sync_product_fifo(old.product_id);
      end if;
    end if;
    if tg_op<>'DELETE' then
      if new.packed_quantity>0 or exists(select 1 from public.inventory_cost_allocations where order_item_id=new.id) then
        perform private.sync_product_fifo(new.product_id);
      end if;
    end if;
  else
    if tg_op='UPDATE' and new.status is not distinct from old.status and new.deleted_at is not distinct from old.deleted_at then return null; end if;
    for v_id in select oi.product_id from public.order_items oi where oi.order_id=new.id
      and (oi.packed_quantity>0 or exists(select 1 from public.inventory_cost_allocations where order_item_id=oi.id))
      order by oi.product_id loop
      perform private.sync_product_fifo(v_id);
    end loop;
  end if;
  return null;
end;
$$;
revoke all on function private.sync_fifo_trigger() from public,anon,authenticated;

notify pgrst,'reload schema';
commit;
