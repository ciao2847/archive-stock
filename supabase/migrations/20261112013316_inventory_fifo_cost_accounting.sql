begin;

alter table public.inventory_databases add column accounting_mode text not null default 'period_total'
  check (accounting_mode in ('period_total','product_fifo'));
-- Explicitly requested inventory only; names are never used for authorization.
update public.inventory_databases set accounting_mode='product_fifo' where name='佛系代購';
alter table public.settlements
  add column accounting_mode text not null default 'period_total',
  add column product_cost numeric(14,2) not null default 0,
  add column product_cost_details jsonb not null default '[]'::jsonb;

create table public.inventory_cost_batches (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.inventory_databases(id),
  product_id uuid not null references public.products(id),
  quantity integer not null check(quantity>0),
  written_off integer not null default 0 check(written_off>=0 and written_off<=quantity),
  unit_cost numeric(12,2) check(unit_cost>=0 and unit_cost<=9999999999.99),
  received_at timestamptz not null default clock_timestamp(),
  notes text not null default '' check(length(notes)<=1000),
  revision integer not null default 1,
  updated_at timestamptz not null default now()
);
create index inventory_cost_batches_product_fifo_idx on public.inventory_cost_batches(product_id,received_at,id);
create index inventory_cost_batches_owner_idx on public.inventory_cost_batches(owner_id);
create table public.inventory_cost_allocations (
  batch_id uuid not null references public.inventory_cost_batches(id),
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  quantity integer not null check(quantity>0),
  primary key(batch_id,order_item_id)
);
create index inventory_cost_allocations_item_idx on public.inventory_cost_allocations(order_item_id);
alter table public.inventory_cost_batches enable row level security;
alter table public.inventory_cost_allocations enable row level security;
revoke all on public.inventory_cost_batches,public.inventory_cost_allocations from public,anon,authenticated;
grant select on public.inventory_cost_batches,public.inventory_cost_allocations to authenticated;
create policy "members read cost batches" on public.inventory_cost_batches for select to authenticated
using(owner_id=(select private.current_inventory_owner_id()) or (select public.my_role())='admin');
create policy "members read cost allocations" on public.inventory_cost_allocations for select to authenticated
using(exists(select 1 from public.inventory_cost_batches b where b.id=batch_id));

-- Reconcile the final transaction state, not intermediate stock changes during returns.
create function private.sync_product_fifo(p_product_id uuid) returns void
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
    insert into public.inventory_cost_batches(owner_id,product_id,quantity,notes)
    values(v_product.owner_id,p_product_id,v_delta,case when v_capacity=0 then '期初庫存／未結算銷售，請補登成本' else '新增庫存，請補登本批成本' end);
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

create function private.sync_fifo_trigger() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  if tg_table_name='products' then
    if tg_op='UPDATE' and new.stock is not distinct from old.stock and new.owner_id is not distinct from old.owner_id then return null; end if;
    perform private.sync_product_fifo(new.id);
  elsif tg_table_name='order_items' then
    if tg_op<>'INSERT' then perform private.sync_product_fifo(old.product_id); end if;
    if tg_op<>'DELETE' then perform private.sync_product_fifo(new.product_id); end if;
  else
    for v_id in select product_id from public.order_items where order_id=new.id order by product_id loop
      perform private.sync_product_fifo(v_id);
    end loop;
  end if;
  return null;
end;
$$;
revoke all on function private.sync_fifo_trigger() from public,anon,authenticated;
create constraint trigger sync_fifo_product after insert or update on public.products deferrable initially deferred
for each row execute function private.sync_fifo_trigger();
create constraint trigger sync_fifo_item after insert or update or delete on public.order_items deferrable initially deferred
for each row execute function private.sync_fifo_trigger();
create constraint trigger sync_fifo_order after insert or update on public.orders deferrable initially deferred
for each row execute function private.sync_fifo_trigger();

create function private.set_inventory_accounting_mode(p_owner_id uuid,p_mode text) returns void
language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  if (select auth.uid()) is null or coalesce((select public.my_role())::text,'') not in ('admin','staff')
    or (p_owner_id is distinct from (select private.current_inventory_owner_id()) and (select public.my_role())<>'admin') then raise exception 'owner access required'; end if;
  if p_mode is null or p_mode not in ('period_total','product_fifo') then raise exception 'invalid accounting mode'; end if;
  perform 1 from public.inventory_databases where id=p_owner_id for update;
  if not found then raise exception 'inventory not found'; end if;
  if p_mode='period_total' and exists(select 1 from public.inventory_cost_batches where owner_id=p_owner_id) then raise exception 'FIFO accounting already started'; end if;
  update public.inventory_databases set accounting_mode=p_mode where id=p_owner_id;
  if p_mode='product_fifo' then
    for v_id in select id from public.products where owner_id=p_owner_id order by id loop perform private.sync_product_fifo(v_id); end loop;
  end if;
end;
$$;
revoke all on function private.set_inventory_accounting_mode(uuid,text) from public,anon;
grant execute on function private.set_inventory_accounting_mode(uuid,text) to authenticated;
create function public.set_inventory_accounting_mode(p_owner_id uuid,p_mode text) returns void
language sql security invoker set search_path='' as $$ select private.set_inventory_accounting_mode(p_owner_id,p_mode) $$;
revoke all on function public.set_inventory_accounting_mode(uuid,text) from public,anon;
grant execute on function public.set_inventory_accounting_mode(uuid,text) to authenticated;

create function private.save_inventory_batch_cost(p_batch_id uuid,p_unit_cost numeric,p_notes text,p_expected_revision integer) returns void
language plpgsql security definer set search_path='' as $$
declare v_batch public.inventory_cost_batches;
begin
  -- Lock the product before the batch, matching sales allocation lock order.
  perform 1 from public.products where id=(select product_id from public.inventory_cost_batches where id=p_batch_id) for update;
  select * into v_batch from public.inventory_cost_batches where id=p_batch_id for update;
  if not found then raise exception 'cost batch not found'; end if;
  if (select auth.uid()) is null or coalesce((select public.my_role())::text,'') not in ('admin','staff')
    or (v_batch.owner_id is distinct from (select private.current_inventory_owner_id()) and (select public.my_role())<>'admin') then raise exception 'owner access required'; end if;
  if p_expected_revision is distinct from v_batch.revision then raise exception 'cost batch changed; reload'; end if;
  if p_unit_cost is null or p_unit_cost<0 or p_unit_cost>9999999999.99 or p_unit_cost<>round(p_unit_cost,2)
    or p_notes is null or length(p_notes)>1000 then raise exception 'invalid batch cost'; end if;
  if exists(select 1 from public.inventory_cost_allocations a join public.order_items oi on oi.id=a.order_item_id
    join public.settlement_orders so on so.order_id=oi.order_id where a.batch_id=p_batch_id) then raise exception 'settled batch cost is locked'; end if;
  update public.inventory_cost_batches set unit_cost=p_unit_cost,notes=p_notes,revision=revision+1,updated_at=now() where id=p_batch_id;
end;
$$;
revoke all on function private.save_inventory_batch_cost(uuid,numeric,text,integer) from public,anon;
grant execute on function private.save_inventory_batch_cost(uuid,numeric,text,integer) to authenticated;
create function public.save_inventory_batch_cost(p_batch_id uuid,p_unit_cost numeric,p_notes text,p_expected_revision integer) returns void
language sql security invoker set search_path='' as $$ select private.save_inventory_batch_cost(p_batch_id,p_unit_cost,p_notes,p_expected_revision) $$;
revoke all on function public.save_inventory_batch_cost(uuid,numeric,text,integer) from public,anon;
grant execute on function public.save_inventory_batch_cost(uuid,numeric,text,integer) to authenticated;

create function public.get_inventory_product_costs(p_product_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v_owner uuid; v_mode text;
begin
  select p.owner_id,i.accounting_mode into v_owner,v_mode from public.products p join public.inventory_databases i on i.id=p.owner_id where p.id=p_product_id;
  if (select auth.uid()) is null or v_owner is null or (v_owner is distinct from (select private.current_inventory_owner_id()) and (select public.my_role())<>'admin') then raise exception 'owner access required'; end if;
  return jsonb_build_object('mode',v_mode,'batches',coalesce((select jsonb_agg(to_jsonb(x) order by x.received_at,x.id) from (
    select b.*,b.quantity-b.written_off-coalesce((select sum(quantity) from public.inventory_cost_allocations where batch_id=b.id),0) as remaining,
    exists(select 1 from public.inventory_cost_allocations a join public.order_items oi on oi.id=a.order_item_id join public.settlement_orders so on so.order_id=oi.order_id where a.batch_id=b.id) as locked
    from public.inventory_cost_batches b where b.product_id=p_product_id) x),'[]'::jsonb));
end;
$$;
revoke all on function public.get_inventory_product_costs(uuid) from public,anon;
grant execute on function public.get_inventory_product_costs(uuid) to authenticated;

-- Seed current inventory plus unsettled outbound units. Never reconstruct closed history.
insert into public.inventory_cost_batches(owner_id,product_id,quantity,notes)
select p.owner_id,p.id,p.stock+coalesce(x.quantity,0),'期初庫存／未結算銷售，請補登成本'
from public.products p join public.inventory_databases i on i.id=p.owner_id
left join lateral(select sum(oi.packed_quantity)::integer quantity from public.order_items oi join public.orders o on o.id=oi.order_id
  where oi.product_id=p.id and o.deleted_at is null and o.status<>'cancelled'
  and not exists(select 1 from public.settlement_orders where order_id=o.id)) x on true
where i.accounting_mode='product_fifo' and p.stock+coalesce(x.quantity,0)>0;
insert into public.inventory_cost_allocations(batch_id,order_item_id,quantity)
select b.id,oi.id,oi.packed_quantity from public.inventory_cost_batches b
join public.order_items oi on oi.product_id=b.product_id join public.orders o on o.id=oi.order_id
where oi.packed_quantity>0 and o.deleted_at is null and o.status<>'cancelled'
  and not exists(select 1 from public.settlement_orders where order_id=o.id);

create function private.guard_fifo_settled_item() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.inventory_cost_allocations a where a.order_item_id=old.id)
    and exists(select 1 from public.settlement_orders where order_id=old.order_id)
    and (tg_op='DELETE' or new.product_id is distinct from old.product_id or new.order_id is distinct from old.order_id
      or new.quantity is distinct from old.quantity or new.packed_quantity is distinct from old.packed_quantity
      or new.unit_price is distinct from old.unit_price) then raise exception 'settled order cannot be changed'; end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;
revoke all on function private.guard_fifo_settled_item() from public,anon,authenticated;
create trigger guard_fifo_settled_item before update or delete on public.order_items for each row execute function private.guard_fifo_settled_item();

create function public.get_financial_product_costs(p_owner_id uuid,p_start date,p_end date) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v_mode text; v_settlement public.settlements; v_rows jsonb; v_missing jsonb;
begin
  if (select auth.uid()) is null or coalesce((select public.my_role())::text,'') not in ('admin','staff')
    or p_owner_id is null or (p_owner_id is distinct from (select private.current_inventory_owner_id()) and (select public.my_role())<>'admin') then raise exception 'owner access required'; end if;
  select * into v_settlement from public.settlements where owner_id=p_owner_id and period_start=p_start and period_end=p_end and cost_source='period_total';
  if found then return jsonb_build_object('mode',v_settlement.accounting_mode,'total',v_settlement.product_cost,'details',v_settlement.product_cost_details,'missing','[]'::jsonb); end if;
  select accounting_mode into v_mode from public.inventory_databases where id=p_owner_id;
  if v_mode<>'product_fifo' then return jsonb_build_object('mode','period_total','total',0,'details','[]'::jsonb,'missing','[]'::jsonb); end if;
  select coalesce(jsonb_agg(jsonb_build_object('batchId',b.id,'orderId',o.id,'orderNo',o.order_no,
    'productId',p.id,'sku',p.sku,'name',p.name,'quantity',a.quantity,'unitCost',b.unit_cost,
    'cost',round(a.quantity*b.unit_cost,2),'receivedAt',b.received_at) order by o.created_at,oi.id,b.received_at,b.id),'[]'::jsonb)
    into v_rows from public.inventory_cost_allocations a join public.inventory_cost_batches b on b.id=a.batch_id
    join public.order_items oi on oi.id=a.order_item_id join public.orders o on o.id=oi.order_id join public.products p on p.id=oi.product_id
    where o.owner_id=p_owner_id and o.deleted_at is null and o.status in ('packed','shipped')
      and (coalesce(o.packed_at,o.created_at) at time zone 'Asia/Taipei')::date between p_start and p_end
      and not exists(select 1 from public.settlement_orders where order_id=o.id);
  select coalesce(jsonb_agg(jsonb_build_object('productId',x.id,'sku',x.sku,'name',x.name,'quantity',x.missing)),'[]'::jsonb) into v_missing from (
    select p.id,p.sku,p.name,sum(oi.quantity-coalesce(a.known,0)) missing from public.order_items oi join public.orders o on o.id=oi.order_id
    join public.products p on p.id=oi.product_id
    left join lateral(select sum(a.quantity) known from public.inventory_cost_allocations a join public.inventory_cost_batches b on b.id=a.batch_id where a.order_item_id=oi.id and b.unit_cost is not null) a on true
    where o.owner_id=p_owner_id and o.deleted_at is null and o.status in ('packed','shipped')
      and (coalesce(o.packed_at,o.created_at) at time zone 'Asia/Taipei')::date between p_start and p_end
      and not exists(select 1 from public.settlement_orders where order_id=o.id)
    group by p.id,p.sku,p.name having sum(oi.quantity-coalesce(a.known,0))>0) x;
  return jsonb_build_object('mode',v_mode,'total',(select coalesce(sum((x->>'cost')::numeric),0) from jsonb_array_elements(v_rows) x),'details',v_rows,'missing',v_missing);
end;
$$;
revoke all on function public.get_financial_product_costs(uuid,date,date) from public,anon;
grant execute on function public.get_financial_product_costs(uuid,date,date) to authenticated;

create or replace function public.get_manual_financial_period_preview(p_owner_id uuid, p_start date, p_end date)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_revenue numeric; v_count integer; v_settlement public.settlements;
begin
  if (select auth.uid()) is null or coalesce((select public.my_role())::text, '') not in ('admin', 'staff')
    or p_owner_id is null or (p_owner_id is distinct from (select private.current_inventory_owner_id())
      and (select public.my_role()) <> 'admin') then raise exception 'owner access required'; end if;
  if p_start is null or p_end is null or extract(year from p_start) not between 2000 and 2100
    or extract(day from p_start) <> 1 or extract(month from p_start)::integer % 2 <> 1
    or p_end <> (p_start + interval '2 months - 1 day')::date then raise exception 'invalid period dates'; end if;
  select * into v_settlement from public.settlements where owner_id = p_owner_id
    and period_start = p_start and period_end = p_end and cost_source = 'period_total';
  if found then
    return jsonb_build_object('revenue', v_settlement.revenue, 'order_count',
      (select count(*) from public.settlement_orders where settlement_id = v_settlement.id),
      'settled', true, 'blocked_reason', null);
  end if;
  select coalesce(sum(x.revenue), 0), count(*) into v_revenue, v_count from (
    select o.id, coalesce(sum(oi.quantity * oi.unit_price), 0) - o.discount as revenue
    from public.orders o left join public.order_items oi on oi.order_id = o.id
    where o.owner_id = p_owner_id and o.deleted_at is null and o.status in ('packed', 'shipped')
      and (coalesce(o.packed_at, o.created_at) at time zone 'Asia/Taipei')::date between p_start and p_end
      and not exists (select 1 from public.settlement_orders so where so.order_id = o.id)
    group by o.id
  ) x;
  return jsonb_build_object('revenue', v_revenue, 'order_count', v_count, 'settled', false,
    'blocked_reason', case when exists (select 1 from public.settlements s where s.owner_id = p_owner_id
      and s.period_start <= p_end and s.period_end >= p_start) then '此帳期與歷史結算重疊，請選擇尚未結算的帳期' else null end);
end;
$$;
revoke all on function public.get_manual_financial_period_preview(uuid,date,date) from public, anon;
grant execute on function public.get_manual_financial_period_preview(uuid,date,date) to authenticated;

create or replace function public.get_financial_period_preview(p_owner_id uuid,p_start date,p_end date) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v_preview jsonb; v_products jsonb;
begin
  v_preview:=public.get_manual_financial_period_preview(p_owner_id,p_start,p_end);
  v_products:=public.get_financial_product_costs(p_owner_id,p_start,p_end);
  return v_preview || jsonb_build_object('accounting_mode',v_products->'mode','product_cost',v_products->'total',
    'product_cost_details',v_products->'details','missing_costs',v_products->'missing');
end;
$$;
revoke all on function public.get_financial_period_preview(uuid,date,date) from public,anon;
grant execute on function public.get_financial_period_preview(uuid,date,date) to authenticated;

create or replace function private.create_period_settlement(
  p_owner_id uuid, p_start date default null, p_end date default null
) returns public.settlements language plpgsql security definer set search_path = '' as $$
declare v_cost public.financial_period_costs; v_settlement public.settlements; v_order_ids uuid[]; v_revenue numeric; v_products jsonb; v_product_id uuid;
begin
  if (select auth.uid()) is null or coalesce((select public.my_role())::text, '') not in ('admin', 'staff')
    or p_owner_id is null or (p_owner_id is distinct from (select private.current_inventory_owner_id())
      and (select public.my_role()) <> 'admin') then raise exception 'owner access required'; end if;
  if p_start is null or p_end is null or extract(year from p_start) not between 2000 and 2100
    or extract(day from p_start) <> 1 or extract(month from p_start)::integer % 2 <> 1
    or p_end <> (p_start + interval '2 months - 1 day')::date then raise exception 'invalid period dates'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner_id::text || p_start::text, 0));
  if exists (select 1 from public.settlements s where s.owner_id = p_owner_id
    and s.period_start <= p_end and s.period_end >= p_start) then raise exception 'period already settled'; end if;
  select * into v_cost from public.financial_period_costs
    where owner_id = p_owner_id and period_start = p_start and period_end = p_end for update;
  if not found then raise exception 'confirm period cost first'; end if;
  -- Freeze the eligible order set before computing the snapshot.
  select coalesce(array_agg(x.id), '{}') into v_order_ids from (
    select o.id from public.orders o
    where o.owner_id = p_owner_id and o.deleted_at is null and o.status in ('packed', 'shipped')
      and (coalesce(o.packed_at, o.created_at) at time zone 'Asia/Taipei')::date between p_start and p_end
      and not exists (select 1 from public.settlement_orders so where so.order_id = o.id)
    order by o.id for update of o
  ) x;
  select coalesce(sum(x.revenue), 0) into v_revenue from (
    select o.id, coalesce(sum(oi.quantity * oi.unit_price), 0) - o.discount as revenue
    from public.orders o left join public.order_items oi on oi.order_id = o.id
    where o.id = any(v_order_ids) group by o.id
  ) x;
  -- Serialize cost edits with FIFO allocation and finish any deferred sale work.
  for v_product_id in select distinct oi.product_id from public.order_items oi where oi.order_id=any(v_order_ids) order by oi.product_id loop
    perform private.sync_product_fifo(v_product_id);
  end loop;
  v_products:=public.get_financial_product_costs(p_owner_id,p_start,p_end);
  if jsonb_array_length(v_products->'missing')>0 then raise exception 'missing product batch costs'; end if;
  insert into public.settlements(owner_id, period_start, period_end, revenue, cost, created_by, cost_source, accounting_mode, product_cost, product_cost_details)
  values (p_owner_id, p_start, p_end, v_revenue, v_cost.amount+(v_products->>'total')::numeric, (select auth.uid()), 'period_total',v_products->>'mode',(v_products->>'total')::numeric,v_products->'details')
  returning * into v_settlement;
  insert into public.settlement_orders(settlement_id, order_id, revenue)
  select v_settlement.id, o.id, coalesce(sum(oi.quantity * oi.unit_price), 0) - o.discount
  from public.orders o left join public.order_items oi on oi.order_id = o.id
  where o.id = any(v_order_ids) group by o.id;
  return v_settlement;
end;
$$;
revoke all on function private.create_period_settlement(uuid,date,date) from public, anon;
grant execute on function private.create_period_settlement(uuid,date,date) to authenticated;


-- Existing report dynamically calls the extended preview; no historical rewrite.
create function private.guard_inventory_accounting_mode() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  if new.accounting_mode is not distinct from old.accounting_mode then return new; end if;
  if (select auth.uid()) is null or coalesce((select public.my_role())::text,'') not in ('admin','staff')
    or (new.id is distinct from (select private.current_inventory_owner_id()) and (select public.my_role())<>'admin') then raise exception 'owner access required'; end if;
  if new.accounting_mode='period_total' and exists(select 1 from public.inventory_cost_batches where owner_id=new.id) then raise exception 'FIFO accounting already started'; end if;
  if new.accounting_mode='product_fifo' then
    for v_id in select id from public.products where owner_id=new.id order by id loop perform private.sync_product_fifo(v_id); end loop;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_inventory_accounting_mode() from public,anon,authenticated;
create trigger guard_inventory_accounting_mode after update of accounting_mode on public.inventory_databases
for each row execute function private.guard_inventory_accounting_mode();
notify pgrst, 'reload schema';
commit;
