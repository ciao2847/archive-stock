-- Future bimonthly settlements count poster sales after discounts, excluding buyer shipping.
-- Existing locked snapshots retain their original totals. Authorization and locks are preserved.
begin;

create or replace function public.get_financial_period_preview(p_owner_id uuid, p_start date, p_end date)
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
revoke all on function public.get_financial_period_preview(uuid,date,date) from public, anon;
grant execute on function public.get_financial_period_preview(uuid,date,date) to authenticated;

create or replace function private.create_period_settlement(
  p_owner_id uuid, p_start date default null, p_end date default null
) returns public.settlements language plpgsql security definer set search_path = '' as $$
declare v_cost public.financial_period_costs; v_settlement public.settlements; v_order_ids uuid[]; v_revenue numeric;
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
  insert into public.settlements(owner_id, period_start, period_end, revenue, cost, created_by, cost_source)
  values (p_owner_id, p_start, p_end, v_revenue, v_cost.amount, (select auth.uid()), 'period_total')
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

commit;
