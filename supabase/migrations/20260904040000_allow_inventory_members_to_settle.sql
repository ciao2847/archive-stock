begin;

-- Apply the settlement permission change to projects that already ran the
-- initial multi-tenant migration.
drop policy if exists "admins read owner settlements" on public.settlements;
drop policy if exists "admins create owner settlements" on public.settlements;
drop policy if exists "inventory members or admins read settlements" on public.settlements;
drop policy if exists "inventory members create owner settlements" on public.settlements;
create policy "inventory members or admins read settlements"
on public.settlements for select to authenticated
using (
  owner_id = (select private.current_inventory_owner_id())
  or (select public.my_role()) = 'admin'
);
create policy "inventory members create owner settlements"
on public.settlements for insert to authenticated
with check (
  owner_id = (select private.current_inventory_owner_id())
  or (select public.my_role()) = 'admin'
);

drop policy if exists "admins read owner settlement orders" on public.settlement_orders;
drop policy if exists "admins create owner settlement orders" on public.settlement_orders;
drop policy if exists "inventory members or admins read settlement orders" on public.settlement_orders;
drop policy if exists "inventory members create owner settlement orders" on public.settlement_orders;
create policy "inventory members or admins read settlement orders"
on public.settlement_orders for select to authenticated
using (
  exists (
    select 1 from public.settlements s
    where s.id = settlement_orders.settlement_id
      and (s.owner_id = (select private.current_inventory_owner_id())
        or (select public.my_role()) = 'admin')
  )
);
create policy "inventory members create owner settlement orders"
on public.settlement_orders for insert to authenticated
with check (
  exists (
    select 1 from public.settlements s
    where s.id = settlement_orders.settlement_id
      and (s.owner_id = (select private.current_inventory_owner_id())
        or (select public.my_role()) = 'admin')
  )
);

drop policy if exists "admins read owner settlement products" on public.settlement_products;
drop policy if exists "admins create owner settlement products" on public.settlement_products;
drop policy if exists "inventory members or admins read settlement products" on public.settlement_products;
drop policy if exists "inventory members create owner settlement products" on public.settlement_products;
create policy "inventory members or admins read settlement products"
on public.settlement_products for select to authenticated
using (
  exists (
    select 1 from public.settlements s
    where s.id = settlement_products.settlement_id
      and (s.owner_id = (select private.current_inventory_owner_id())
        or (select public.my_role()) = 'admin')
  )
);
create policy "inventory members create owner settlement products"
on public.settlement_products for insert to authenticated
with check (
  exists (
    select 1 from public.settlements s
    where s.id = settlement_products.settlement_id
      and (s.owner_id = (select private.current_inventory_owner_id())
        or (select public.my_role()) = 'admin')
  )
);

create or replace function public.create_financial_settlement(
  p_owner_id uuid,
  p_start date default null,
  p_end date default null
)
returns public.settlements
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_settlement public.settlements;
  v_revenue numeric(14,2);
  v_cost numeric(14,2);
begin
  if (select auth.uid()) is null
    or (select public.my_role()) not in ('admin', 'staff') then
    raise exception 'employee access required';
  end if;
  if (select public.my_role()) <> 'admin'
    and p_owner_id <> (select private.current_inventory_owner_id()) then
    raise exception 'owner access required';
  end if;
  if not exists (select 1 from public.profiles where id = p_owner_id) then
    raise exception 'owner not found';
  end if;

  select coalesce(sum(x.net_revenue), 0) into v_revenue
  from (
    select o.id,
      coalesce(sum(oi.quantity * oi.unit_price), 0)
        + o.shipping_income - o.discount - o.platform_fee
        - o.seller_shipping_cost as net_revenue
    from public.orders o
    join public.order_items oi on oi.order_id = o.id
    where o.owner_id = p_owner_id
      and o.status in ('packed', 'shipped')
      and not exists (
        select 1 from public.settlement_orders so
        where so.order_id = o.id
      )
      and (p_start is null or coalesce(o.packed_at, o.created_at)::date >= p_start)
      and (p_end is null or coalesce(o.packed_at, o.created_at)::date <= p_end)
    group by o.id
  ) x;

  select coalesce(sum(coalesce(p.cost, 0)), 0) into v_cost
  from public.products p
  where p.owner_id = p_owner_id
    and not exists (
      select 1 from public.settlement_products sp
      where sp.product_id = p.id
    );
  if v_revenue = 0 and v_cost = 0 then
    raise exception 'no unsettled financial data';
  end if;

  insert into public.settlements(owner_id, period_start, period_end, revenue, cost, created_by)
  values (p_owner_id, p_start, p_end, v_revenue, v_cost, (select auth.uid()))
  returning * into v_settlement;

  insert into public.settlement_orders(settlement_id, order_id, revenue)
  select v_settlement.id, o.id,
    coalesce(sum(oi.quantity * oi.unit_price), 0)
      + o.shipping_income - o.discount - o.platform_fee
      - o.seller_shipping_cost
  from public.orders o
  join public.order_items oi on oi.order_id = o.id
  where o.owner_id = p_owner_id
    and o.status in ('packed', 'shipped')
    and not exists (
      select 1 from public.settlement_orders so
      where so.order_id = o.id
    )
    and (p_start is null or coalesce(o.packed_at, o.created_at)::date >= p_start)
    and (p_end is null or coalesce(o.packed_at, o.created_at)::date <= p_end)
  group by o.id;

  insert into public.settlement_products(settlement_id, product_id, cost)
  select v_settlement.id, p.id, coalesce(p.cost, 0)
  from public.products p
  where p.owner_id = p_owner_id
    and not exists (
      select 1 from public.settlement_products sp
      where sp.product_id = p.id
    );
  return v_settlement;
end;
$$;

revoke all on function public.create_financial_settlement(uuid, date, date) from public, anon;
grant execute on function public.create_financial_settlement(uuid, date, date) to authenticated;

notify pgrst, 'reload schema';
commit;