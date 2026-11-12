begin;

alter table public.products add column purchase_unit_cost numeric(12,2)
  check(purchase_unit_cost >= 0 and purchase_unit_cost <= 9999999999.99);
-- Preserve actual receipt costs; use the latest known receipt only as a default.
update public.products p set purchase_unit_cost=(
  select b.unit_cost from public.inventory_cost_batches b where b.product_id=p.id and b.unit_cost is not null
  order by b.received_at desc,b.id desc limit 1
) where exists(select 1 from public.inventory_databases i where i.id=p.owner_id and i.accounting_mode='product_fifo');

create or replace function private.sync_product_fifo(p_product_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v_product public.products; v_item record; v_batch record; v_allocation record;
  v_desired integer; v_used integer; v_delta integer; v_take integer; v_capacity integer;
begin
  select * into v_product from public.products where id=p_product_id for update;
  if not found then return; end if;
  if not exists(select 1 from public.inventory_databases where id=v_product.owner_id and accounting_mode='product_fifo') then return; end if;
  if (select auth.uid()) is null or coalesce((select public.my_role())::text,'') not in ('admin','staff')
    or (v_product.owner_id is distinct from (select private.current_inventory_owner_id()) and (select public.my_role())<>'admin') then
    raise exception 'owner access required'; end if;
  -- Release only the reduced portion, retaining all unchanged sale allocations.
  for v_item in select oi.*,o.status,o.deleted_at from public.order_items oi join public.orders o on o.id=oi.order_id
    where oi.product_id=p_product_id order by oi.id loop
    select coalesce(sum(quantity),0) into v_used from public.inventory_cost_allocations where order_item_id=v_item.id;
    if exists(select 1 from public.settlement_orders where order_id=v_item.order_id) then continue; end if;
    v_desired:=case when v_item.deleted_at is null and v_item.status<>'cancelled' then v_item.packed_quantity else 0 end;
    v_delta:=v_used-v_desired;
    if v_delta>0 then
      for v_allocation in select a.*,b.received_at from public.inventory_cost_allocations a
        join public.inventory_cost_batches b on b.id=a.batch_id where a.order_item_id=v_item.id order by b.received_at desc,b.id desc loop
        v_take:=least(v_delta,v_allocation.quantity);
        if v_take=v_allocation.quantity then delete from public.inventory_cost_allocations where batch_id=v_allocation.batch_id and order_item_id=v_item.id;
        else update public.inventory_cost_allocations set quantity=quantity-v_take where batch_id=v_allocation.batch_id and order_item_id=v_item.id; end if;
        v_delta:=v_delta-v_take; exit when v_delta=0;
      end loop;
    end if;
  end loop;
  -- Required receipts = current physical stock + tracked outbound units + adjustments.
  select coalesce(sum(case when so.order_id is not null then coalesce(a.n,0)
    when o.deleted_at is null and o.status<>'cancelled' then oi.packed_quantity else 0 end),0)
    into v_desired from public.order_items oi join public.orders o on o.id=oi.order_id
    left join public.settlement_orders so on so.order_id=o.id
    left join lateral(select sum(quantity) n from public.inventory_cost_allocations where order_item_id=oi.id) a on true
    where oi.product_id=p_product_id;
  select coalesce(sum(quantity-written_off),0) into v_capacity from public.inventory_cost_batches where product_id=p_product_id;
  v_delta:=v_product.stock+v_desired-v_capacity;
  if v_delta>0 then
    insert into public.inventory_cost_batches(owner_id,product_id,quantity,unit_cost,notes)
    values(v_product.owner_id,p_product_id,v_delta,v_product.purchase_unit_cost,case when v_capacity=0 then '期初庫存／未結算銷售，請補登成本' else '新增庫存，請補登本批成本' end);
  end if;
  -- Allocate only additional sold units. Chronological orders and FIFO receipts.
  for v_item in select oi.*,o.created_at from public.order_items oi join public.orders o on o.id=oi.order_id
    where oi.product_id=p_product_id and o.deleted_at is null and o.status<>'cancelled'
      and not exists(select 1 from public.settlement_orders where order_id=o.id)
    order by coalesce(o.packed_at,o.created_at),o.id,oi.id loop
    select v_item.packed_quantity-coalesce(sum(quantity),0) into v_delta from public.inventory_cost_allocations where order_item_id=v_item.id;
    if v_delta<=0 then continue; end if;
    for v_batch in select b.*,b.quantity-b.written_off-coalesce((select sum(quantity) from public.inventory_cost_allocations where batch_id=b.id),0) as available
      from public.inventory_cost_batches b where b.product_id=p_product_id order by b.received_at,b.id loop
      v_take:=least(v_delta,v_batch.available); if v_take<=0 then continue; end if;
      insert into public.inventory_cost_allocations(batch_id,order_item_id,quantity) values(v_batch.id,v_item.id,v_take)
      on conflict(batch_id,order_item_id) do update set quantity=public.inventory_cost_allocations.quantity+excluded.quantity;
      v_delta:=v_delta-v_take; exit when v_delta=0;
    end loop;
    if v_delta>0 then raise exception 'insufficient cost batch quantity'; end if;
  end loop;
  -- Non-sale stock reductions are inventory adjustments, never sale expense.
  select coalesce(sum(b.quantity-b.written_off-coalesce(a.n,0)),0)-v_product.stock into v_delta
    from public.inventory_cost_batches b left join lateral(select sum(quantity) n from public.inventory_cost_allocations where batch_id=b.id) a on true
    where b.product_id=p_product_id;
  if v_delta>0 then
    for v_batch in select b.*,b.quantity-b.written_off-coalesce((select sum(quantity) from public.inventory_cost_allocations where batch_id=b.id),0) as available
      from public.inventory_cost_batches b where b.product_id=p_product_id order by b.received_at,b.id loop
      v_take:=least(v_delta,v_batch.available); if v_take<=0 then continue; end if;
      update public.inventory_cost_batches set written_off=written_off+v_take where id=v_batch.id;
      v_delta:=v_delta-v_take; exit when v_delta=0;
    end loop;
  end if;
end;
$$;
revoke all on function private.sync_product_fifo(uuid) from public,anon,authenticated;

create or replace function public.get_inventory_product_costs(p_product_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v_owner uuid; v_mode text; v_unit_cost numeric;
begin
  select p.owner_id,i.accounting_mode,p.purchase_unit_cost into v_owner,v_mode,v_unit_cost from public.products p join public.inventory_databases i on i.id=p.owner_id where p.id=p_product_id;
  if (select auth.uid()) is null or v_owner is null or (v_owner is distinct from (select private.current_inventory_owner_id()) and (select public.my_role())<>'admin') then raise exception 'owner access required'; end if;
  return jsonb_build_object('mode',v_mode,'unitCost',v_unit_cost,'batches',coalesce((select jsonb_agg(to_jsonb(x) order by x.received_at,x.id) from (
    select b.*,b.quantity-b.written_off-coalesce((select sum(quantity) from public.inventory_cost_allocations where batch_id=b.id),0) as remaining,
    exists(select 1 from public.inventory_cost_allocations a join public.order_items oi on oi.id=a.order_item_id join public.settlement_orders so on so.order_id=oi.order_id where a.batch_id=b.id) as locked
    from public.inventory_cost_batches b where b.product_id=p_product_id) x),'[]'::jsonb));
end;
$$;
revoke all on function public.get_inventory_product_costs(uuid) from public,anon;
grant execute on function public.get_inventory_product_costs(uuid) to authenticated;

create function private.save_inventory_product_with_cost(
  p_input jsonb,p_owner_id uuid default null,p_product_id uuid default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_id uuid; v_owner uuid; v_stock integer := 0; v_mode text; v_unit_cost numeric;
  v_batch public.inventory_cost_batches; v_batch_id uuid; v_revision integer;
  v_images text[]; v_crafts text[];
begin
  if (select auth.uid()) is null or coalesce((select public.my_role())::text,'') not in ('admin','staff') then raise exception 'owner access required'; end if;
  if jsonb_typeof(p_input) is distinct from 'object' or jsonb_typeof(p_input->'unitCost') is distinct from 'number' then raise exception 'invalid product unit cost'; end if;
  v_unit_cost := (p_input->>'unitCost')::numeric;
  if v_unit_cost<0 or v_unit_cost>9999999999.99 or v_unit_cost<>round(v_unit_cost,2) then raise exception 'invalid product unit cost'; end if;
  if p_product_id is null then v_owner:=p_owner_id;
  else
    select owner_id,stock into v_owner,v_stock from public.products where id=p_product_id for update;
    if not found then raise exception 'product not found'; end if;
    if p_owner_id is not null and p_owner_id is distinct from v_owner then raise exception 'owner access required'; end if;
  end if;
  if v_owner is null or (v_owner is distinct from (select private.current_inventory_owner_id()) and (select public.my_role())<>'admin') then raise exception 'owner access required'; end if;
  select accounting_mode into v_mode from public.inventory_databases where id=v_owner;
  if v_mode is distinct from 'product_fifo' then raise exception 'inventory uses period costs'; end if;
  if p_input ? 'costBatchId' then
    v_batch_id:=(p_input->>'costBatchId')::uuid;
    v_revision:=(p_input->>'expectedCostRevision')::integer;
    select * into v_batch from public.inventory_cost_batches where id=v_batch_id and product_id=p_product_id for update;
    if not found then raise exception 'cost batch not found'; end if;
    if v_revision is distinct from v_batch.revision then raise exception 'cost batch changed; reload'; end if;
    if (p_input->>'stock')::integer>v_stock then raise exception 'receipt cost cannot change previous batch'; end if;
  end if;
  if jsonb_typeof(p_input->'imagePaths')='array' then v_images:=array(select jsonb_array_elements_text(p_input->'imagePaths')); end if;
  if jsonb_typeof(p_input->'crafts')='array' then v_crafts:=array(select jsonb_array_elements_text(p_input->'crafts')); end if;
  if p_input ? 'preorderItemName' then
    v_id:=public.save_named_inventory_product(p_input,v_owner,p_product_id);
  elsif p_product_id is null then
    v_id:=public.create_inventory_product(
      p_name=>p_input->>'name',p_work=>p_input->>'work',p_category=>p_input->>'category',p_country=>p_input->>'country',
      p_source=>p_input->>'source',p_location=>p_input->>'location',p_stock=>(p_input->>'stock')::integer,
      p_price=>(p_input->>'price')::numeric,p_cost=>0,p_image_paths=>v_images,p_poster_format=>p_input->>'format',
      p_poster_size=>p_input->>'size',p_poster_crafts=>v_crafts,p_identifying_features=>p_input->>'feature',
      p_owner_id=>v_owner,p_description=>p_input->>'description');
  else
    if not public.update_inventory_product(
      p_product_id=>p_product_id,p_name=>p_input->>'name',p_category=>p_input->>'category',p_country=>p_input->>'country',
      p_source=>p_input->>'source',p_location=>p_input->>'location',p_stock=>(p_input->>'stock')::integer,
      p_price=>(p_input->>'price')::numeric,p_cost=>null,p_poster_format=>p_input->>'format',p_poster_size=>p_input->>'size',
      p_identifying_features=>p_input->>'feature',p_work=>p_input->>'work',p_poster_crafts=>v_crafts,
      p_image_paths=>v_images,p_description=>p_input->>'description') then raise exception 'product not updated'; end if;
    v_id:=p_product_id;
  end if;
  update public.products set purchase_unit_cost=v_unit_cost where id=v_id;
  perform private.sync_product_fifo(v_id);
  if v_batch_id is not null and v_batch.unit_cost is distinct from v_unit_cost then
    perform public.save_inventory_batch_cost(v_batch_id,v_unit_cost,v_batch.notes,v_revision);
  end if;
  return v_id;
end;
$$;
revoke all on function private.save_inventory_product_with_cost(jsonb,uuid,uuid) from public,anon;
grant execute on function private.save_inventory_product_with_cost(jsonb,uuid,uuid) to authenticated;
create function public.save_inventory_product_with_cost(
  p_input jsonb,p_owner_id uuid default null,p_product_id uuid default null
) returns uuid language sql security invoker set search_path='' as $$
  select private.save_inventory_product_with_cost(p_input,p_owner_id,p_product_id)
$$;
revoke all on function public.save_inventory_product_with_cost(jsonb,uuid,uuid) from public,anon;
grant execute on function public.save_inventory_product_with_cost(jsonb,uuid,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
