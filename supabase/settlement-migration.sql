create sequence if not exists public.settlement_number_seq start 1;

create table if not exists public.settlements (
  id uuid primary key default gen_random_uuid(),
  settlement_no text unique not null default ('SETTLE-' || lpad(nextval('public.settlement_number_seq')::text, 6, '0')),
  period_start date,
  period_end date,
  revenue numeric(14,2) not null default 0,
  cost numeric(14,2) not null default 0,
  profit numeric(14,2) generated always as (revenue - cost) stored,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.settlement_orders (
  settlement_id uuid not null references public.settlements(id) on delete cascade,
  order_id uuid not null references public.orders(id),
  revenue numeric(14,2) not null check (revenue >= 0),
  primary key (settlement_id, order_id),
  unique (order_id)
);

create table if not exists public.settlement_products (
  settlement_id uuid not null references public.settlements(id) on delete cascade,
  product_id uuid not null references public.products(id),
  cost numeric(14,2) not null check (cost >= 0),
  primary key (settlement_id, product_id),
  unique (product_id)
);

create index if not exists settlements_created_at_idx on public.settlements(created_at desc);
alter table public.settlements enable row level security;
alter table public.settlement_orders enable row level security;
alter table public.settlement_products enable row level security;

create policy "admin reads settlements" on public.settlements for select to authenticated using (public.my_role()='admin');
create policy "admin reads settlement orders" on public.settlement_orders for select to authenticated using (public.my_role()='admin');
create policy "admin reads settlement products" on public.settlement_products for select to authenticated using (public.my_role()='admin');

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

  select coalesce(sum(oi.quantity * oi.unit_price),0) into v_revenue
  from public.orders o join public.order_items oi on oi.order_id=o.id
  where o.status in ('packed','shipped')
    and not exists(select 1 from public.settlement_orders so where so.order_id=o.id)
    and (p_start is null or coalesce(o.packed_at,o.created_at)::date >= p_start)
    and (p_end is null or coalesce(o.packed_at,o.created_at)::date <= p_end);

  select coalesce(sum(coalesce(p.cost,0)),0) into v_cost
  from public.products p
  where not exists(select 1 from public.settlement_products sp where sp.product_id=p.id);

  if v_revenue=0 and v_cost=0 then raise exception 'no unsettled financial data'; end if;
  insert into public.settlements(period_start,period_end,revenue,cost,created_by)
  values(p_start,p_end,v_revenue,v_cost,auth.uid()) returning * into v_settlement;

  insert into public.settlement_orders(settlement_id,order_id,revenue)
  select v_settlement.id,o.id,sum(oi.quantity*oi.unit_price)
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

create or replace function public.set_admin_product_cost(p_product_id uuid, p_cost numeric)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null or public.my_role() <> 'admin' then raise exception 'admin access required'; end if;
  if p_cost < 0 then raise exception 'cost cannot be negative'; end if;
  update public.products set cost=p_cost,updated_at=now() where id=p_product_id;
end $$;

revoke execute on function public.set_admin_product_cost(uuid,numeric) from public, anon;
grant execute on function public.set_admin_product_cost(uuid,numeric) to authenticated;
