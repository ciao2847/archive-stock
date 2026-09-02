alter table public.orders
  add column if not exists sales_channel text not null default 'direct',
  add column if not exists discount numeric(12,2) not null default 0,
  add column if not exists shipping_income numeric(12,2) not null default 0,
  add column if not exists platform_fee numeric(12,2) not null default 0,
  add column if not exists seller_shipping_cost numeric(12,2) not null default 0;

do $$
declare
  v_column text;
begin
  foreach v_column in array array['discount','shipping_income','platform_fee','seller_shipping_cost'] loop
    if not exists (
      select 1 from pg_constraint
      where conname = 'orders_' || v_column || '_nonnegative'
        and conrelid = 'public.orders'::regclass
    ) then
      execute format(
        'alter table public.orders add constraint %I check (%I >= 0)',
        'orders_' || v_column || '_nonnegative',
        v_column
      );
    end if;
  end loop;
end $$;

alter table public.settlement_orders
  drop constraint if exists settlement_orders_revenue_check;

create or replace function public.create_financial_settlement(p_start date default null, p_end date default null)
returns public.settlements
language plpgsql security definer set search_path=public
as $$
declare
  v_settlement public.settlements;
  v_revenue numeric(14,2);
  v_cost numeric(14,2);
begin
  if auth.uid() is null or public.my_role() <> 'admin' then raise exception 'admin access required'; end if;

  select coalesce(sum(x.net_revenue),0) into v_revenue
  from (
    select o.id,
      coalesce(sum(oi.quantity * oi.unit_price),0)
      + o.shipping_income - o.discount - o.platform_fee - o.seller_shipping_cost as net_revenue
    from public.orders o
    join public.order_items oi on oi.order_id=o.id
    where o.status in ('packed','shipped')
      and not exists(select 1 from public.settlement_orders so where so.order_id=o.id)
      and (p_start is null or coalesce(o.packed_at,o.created_at)::date >= p_start)
      and (p_end is null or coalesce(o.packed_at,o.created_at)::date <= p_end)
    group by o.id
  ) x;

  select coalesce(sum(coalesce(p.cost,0)),0) into v_cost
  from public.products p
  where not exists(select 1 from public.settlement_products sp where sp.product_id=p.id);

  if v_revenue=0 and v_cost=0 then raise exception 'no unsettled financial data'; end if;
  insert into public.settlements(period_start,period_end,revenue,cost,created_by)
  values(p_start,p_end,v_revenue,v_cost,auth.uid()) returning * into v_settlement;

  insert into public.settlement_orders(settlement_id,order_id,revenue)
  select v_settlement.id,o.id,
    coalesce(sum(oi.quantity*oi.unit_price),0)
    + o.shipping_income - o.discount - o.platform_fee - o.seller_shipping_cost
  from public.orders o join public.order_items oi on oi.order_id=o.id
  where o.status in ('packed','shipped')
    and not exists(select 1 from public.settlement_orders so where so.order_id=o.id)
    and (p_start is null or coalesce(o.packed_at,o.created_at)::date >= p_start)
    and (p_end is null or coalesce(o.packed_at,o.created_at)::date <= p_end)
  group by o.id;

  insert into public.settlement_products(settlement_id,product_id,cost)
  select v_settlement.id,p.id,coalesce(p.cost,0) from public.products p
  where not exists(select 1 from public.settlement_products sp where sp.product_id=p.id);
  return v_settlement;
end $$;

revoke execute on function public.create_financial_settlement(date,date) from public, anon;
grant execute on function public.create_financial_settlement(date,date) to authenticated;

create or replace function public.update_order_financials(
  p_order_id uuid,
  p_sales_channel text,
  p_discount numeric,
  p_shipping_income numeric,
  p_platform_fee numeric,
  p_seller_shipping_cost numeric,
  p_items jsonb
)
returns boolean
language plpgsql security invoker set search_path=public
as $$
declare
  v_status public.order_status;
  v_item jsonb;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if p_discount < 0 or p_shipping_income < 0 or p_platform_fee < 0 or p_seller_shipping_cost < 0 then
    raise exception 'financial amounts cannot be negative';
  end if;

  select status into v_status from public.orders where id=p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  if v_status not in ('pending','packing') then raise exception 'order financials are locked'; end if;
  if exists(select 1 from public.settlement_orders where order_id=p_order_id) then raise exception 'settled order cannot be changed'; end if;

  update public.orders set
    sales_channel=coalesce(nullif(trim(p_sales_channel),''),'direct'),
    discount=p_discount,
    shipping_income=p_shipping_income,
    platform_fee=p_platform_fee,
    seller_shipping_cost=p_seller_shipping_cost,
    updated_at=now()
  where id=p_order_id;

  for v_item in select value from jsonb_array_elements(p_items) loop
    if (v_item->>'unit_price')::numeric < 0 then raise exception 'unit price cannot be negative'; end if;
    update public.order_items
    set unit_price=(v_item->>'unit_price')::numeric
    where id=(v_item->>'id')::uuid and order_id=p_order_id;
    if not found then raise exception 'order item not found'; end if;
  end loop;
  return true;
end $$;

revoke execute on function public.update_order_financials(uuid,text,numeric,numeric,numeric,numeric,jsonb) from public, anon;
grant execute on function public.update_order_financials(uuid,text,numeric,numeric,numeric,numeric,jsonb) to authenticated;
