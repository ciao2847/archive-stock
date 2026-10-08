begin;

-- Legacy product costs and settlement snapshots remain for historical reference.
-- New accounting uses exactly one confirmed total per inventory / two-month period.
create table public.financial_period_costs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.inventory_databases(id),
  period_start date not null,
  period_end date not null,
  amount numeric(14,2) not null check (amount >= 0),
  calculator_path text,
  evidence_paths text[] not null default '{}',
  notes text not null default '' check (length(notes) <= 2000),
  revision integer not null default 1 check (revision > 0),
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, period_start),
  check (extract(year from period_start) between 2000 and 2100
    and extract(day from period_start) = 1
    and extract(month from period_start)::integer % 2 = 1
    and period_end = (period_start + interval '2 months - 1 day')::date),
  check (cardinality(evidence_paths) <= 10)
);
create table public.financial_period_cost_revisions (
  cost_id uuid not null references public.financial_period_costs(id),
  revision integer not null,
  owner_id uuid not null references public.inventory_databases(id),
  amount numeric(14,2) not null,
  calculator_path text,
  evidence_paths text[] not null,
  notes text not null,
  changed_by uuid not null references public.profiles(id),
  changed_at timestamptz not null default now(),
  primary key (cost_id, revision)
);
create index financial_period_cost_revisions_owner_idx on public.financial_period_cost_revisions(owner_id);
alter table public.financial_period_costs enable row level security;
alter table public.financial_period_cost_revisions enable row level security;
revoke all on public.financial_period_costs, public.financial_period_cost_revisions from public, anon, authenticated;
grant select, insert, update on public.financial_period_costs to authenticated;
grant select on public.financial_period_cost_revisions to authenticated;
create policy "members read period costs" on public.financial_period_costs
for select to authenticated using (
  owner_id = (select private.current_inventory_owner_id()) or (select public.my_role()) = 'admin'
);
create policy "members insert period costs" on public.financial_period_costs
for insert to authenticated with check (
  (select public.my_role()) in ('admin', 'staff')
  and (owner_id = (select private.current_inventory_owner_id()) or (select public.my_role()) = 'admin')
);
create policy "members update period costs" on public.financial_period_costs
for update to authenticated using (
  owner_id = (select private.current_inventory_owner_id()) or (select public.my_role()) = 'admin'
) with check (
  (select public.my_role()) in ('admin', 'staff')
  and (owner_id = (select private.current_inventory_owner_id()) or (select public.my_role()) = 'admin')
);
create policy "members read cost revisions" on public.financial_period_cost_revisions
for select to authenticated using (
  owner_id = (select private.current_inventory_owner_id()) or (select public.my_role()) = 'admin'
);

alter table public.settlements add column cost_source text not null default 'legacy_product'
  check (cost_source in ('legacy_product', 'period_total'));
create unique index settlements_period_total_unique on public.settlements(owner_id, period_start)
  where cost_source = 'period_total';
alter table public.settlements add constraint settlements_period_total_dates check (
  cost_source <> 'period_total' or (period_start is not null and period_end is not null
    and extract(day from period_start) = 1 and extract(month from period_start)::integer % 2 = 1
    and period_end = (period_start + interval '2 months - 1 day')::date)
);

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('finance-images', 'finance-images', false, 8388608, array['image/webp', 'image/png', 'image/jpeg']);
create policy "members read finance images" on storage.objects for select to authenticated
using (bucket_id = 'finance-images' and (
  (storage.foldername(name))[1] = (select private.current_inventory_owner_id())::text
  or (select public.my_role()) = 'admin'
));
create policy "members upload finance images" on storage.objects for insert to authenticated
with check (bucket_id = 'finance-images'
  and (select public.my_role()) in ('admin', 'staff')
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and ((storage.foldername(name))[1] = (select private.current_inventory_owner_id())::text
    or (select public.my_role()) = 'admin')
);
-- Saved images, including previous revisions, cannot be removed through Storage.
create policy "members remove unused finance images" on storage.objects for delete to authenticated
using (bucket_id = 'finance-images'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and ((storage.foldername(name))[1] = (select private.current_inventory_owner_id())::text
    or (select public.my_role()) = 'admin')
  and not exists (select 1 from public.financial_period_costs c
    where c.calculator_path = name or name = any(c.evidence_paths))
  and not exists (select 1 from public.financial_period_cost_revisions r
    where r.calculator_path = name or name = any(r.evidence_paths))
);

create function private.guard_period_cost() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare v_path text;
begin
  if (select auth.uid()) is null or coalesce((select public.my_role())::text, '') not in ('admin', 'staff')
    or (new.owner_id is distinct from (select private.current_inventory_owner_id())
      and (select public.my_role()) <> 'admin') then
    raise exception 'owner access required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.owner_id::text || new.period_start::text, 0));
  if tg_op = 'UPDATE' and (new.id is distinct from old.id or new.owner_id is distinct from old.owner_id
    or new.period_start is distinct from old.period_start or new.period_end is distinct from old.period_end
    or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at) then
    raise exception 'period identity cannot be changed';
  end if;
  if exists (select 1 from public.settlements s where s.owner_id = new.owner_id
    and s.period_start <= new.period_end and s.period_end >= new.period_start) then
    raise exception 'period already settled';
  end if;
  foreach v_path in array (new.evidence_paths || case when new.calculator_path is null then '{}'::text[] else array[new.calculator_path] end) loop
    if v_path is null or v_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(webp|png|jpg)$'
      or split_part(v_path, '/', 1) <> new.owner_id::text
      or not exists (select 1 from storage.objects o where o.bucket_id = 'finance-images' and o.name = v_path) then
      raise exception 'invalid finance image';
    end if;
  end loop;
  if (select count(*) <> count(distinct p) from unnest(new.evidence_paths ||
    case when new.calculator_path is null then '{}'::text[] else array[new.calculator_path] end) p) then
    raise exception 'duplicate finance image';
  end if;
  new.revision := case when tg_op = 'INSERT' then 1 else old.revision + 1 end;
  if tg_op = 'INSERT' then new.created_by := (select auth.uid()); end if;
  new.updated_by := (select auth.uid());
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function private.guard_period_cost() from public, anon, authenticated;
create trigger guard_period_cost before insert or update on public.financial_period_costs
for each row execute function private.guard_period_cost();

-- Audit is written by a private trigger; callers have no write privileges.
create function private.record_period_cost_revision() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or new.updated_by is distinct from (select auth.uid())
    or coalesce((select public.my_role())::text, '') not in ('admin', 'staff')
    or (new.owner_id is distinct from (select private.current_inventory_owner_id())
      and (select public.my_role()) <> 'admin') then raise exception 'owner access required'; end if;
  insert into public.financial_period_cost_revisions(cost_id, revision, owner_id, amount,
    calculator_path, evidence_paths, notes, changed_by)
  values (new.id, new.revision, new.owner_id, new.amount, new.calculator_path,
    new.evidence_paths, new.notes, new.updated_by);
  return new;
end;
$$;
revoke all on function private.record_period_cost_revision() from public, anon, authenticated;
create trigger record_period_cost_revision after insert or update on public.financial_period_costs
for each row execute function private.record_period_cost_revision();

create function public.confirm_financial_period_cost(
  p_owner_id uuid, p_start date, p_end date, p_amount numeric,
  p_calculator_path text, p_evidence_paths text[], p_notes text, p_expected_revision integer
) returns public.financial_period_costs
language plpgsql security invoker set search_path = '' as $$
declare v_cost public.financial_period_costs;
begin
  if (select auth.uid()) is null or coalesce((select public.my_role())::text, '') not in ('admin', 'staff')
    or p_owner_id is null or (p_owner_id is distinct from (select private.current_inventory_owner_id())
      and (select public.my_role()) <> 'admin') then raise exception 'owner access required'; end if;
  if p_amount is null or p_amount < 0 or p_amount > 999999999999.99
    or p_amount <> round(p_amount, 2) then raise exception 'invalid period amount'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner_id::text || p_start::text, 0));
  select * into v_cost from public.financial_period_costs
    where owner_id = p_owner_id and period_start = p_start for update;
  if p_expected_revision is distinct from coalesce(v_cost.revision, 0) then
    raise exception 'period cost was changed; reload';
  end if;
  if v_cost.id is null then
    insert into public.financial_period_costs(owner_id, period_start, period_end, amount,
      calculator_path, evidence_paths, notes, created_by, updated_by)
    values (p_owner_id, p_start, p_end, p_amount, p_calculator_path,
      coalesce(p_evidence_paths, '{}'), coalesce(p_notes, ''), (select auth.uid()), (select auth.uid()))
    returning * into v_cost;
  else
    update public.financial_period_costs set amount = p_amount, calculator_path = p_calculator_path,
      evidence_paths = coalesce(p_evidence_paths, '{}'), notes = coalesce(p_notes, '')
    where id = v_cost.id and period_end = p_end returning * into v_cost;
    if not found then raise exception 'invalid period dates'; end if;
  end if;
  return v_cost;
end;
$$;
revoke all on function public.confirm_financial_period_cost(uuid,date,date,numeric,text,text[],text,integer) from public, anon;
grant execute on function public.confirm_financial_period_cost(uuid,date,date,numeric,text,text[],text,integer) to authenticated;

create function public.get_financial_period_preview(p_owner_id uuid, p_start date, p_end date)
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
    select o.id, coalesce(sum(oi.quantity * oi.unit_price), 0) + o.shipping_income - o.discount as revenue
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

create function private.create_period_settlement(
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
    select o.id, coalesce(sum(oi.quantity * oi.unit_price), 0) + o.shipping_income - o.discount as revenue
    from public.orders o left join public.order_items oi on oi.order_id = o.id
    where o.id = any(v_order_ids) group by o.id
  ) x;
  insert into public.settlements(owner_id, period_start, period_end, revenue, cost, created_by, cost_source)
  values (p_owner_id, p_start, p_end, v_revenue, v_cost.amount, (select auth.uid()), 'period_total')
  returning * into v_settlement;
  insert into public.settlement_orders(settlement_id, order_id, revenue)
  select v_settlement.id, o.id, coalesce(sum(oi.quantity * oi.unit_price), 0) + o.shipping_income - o.discount
  from public.orders o left join public.order_items oi on oi.order_id = o.id
  where o.id = any(v_order_ids) group by o.id;
  return v_settlement;
end;
$$;
revoke all on function private.create_period_settlement(uuid,date,date) from public, anon;
grant execute on function private.create_period_settlement(uuid,date,date) to authenticated;
-- Snapshots are created only through the checked private RPC. Table INSERT grants
-- would otherwise allow a browser to forge totals or attach orders after closing.
revoke insert, update on public.settlements from authenticated;
revoke insert, update, delete on public.settlement_orders, public.settlement_products from authenticated;
create or replace function public.create_financial_settlement(
  p_owner_id uuid, p_start date default null, p_end date default null
) returns public.settlements language sql security invoker set search_path = '' as $$
  select * from private.create_period_settlement(p_owner_id, p_start, p_end)
$$;
revoke all on function public.create_financial_settlement(uuid,date,date) from public, anon;
grant execute on function public.create_financial_settlement(uuid,date,date) to authenticated;

create function private.guard_period_settlement() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' and new.cost_source <> 'period_total' then
    raise exception 'product cost accounting has been retired';
  end if;
  if tg_op in ('UPDATE', 'DELETE') and old.cost_source = 'period_total' then
    raise exception 'settled period cannot be changed';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function private.guard_period_settlement() from public, anon, authenticated;
create trigger guard_period_settlement before insert or update or delete on public.settlements
for each row execute function private.guard_period_settlement();

-- Disable legacy product-cost writes without deleting archived values.
create function private.retire_product_cost() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then new.cost := 0;
  elsif new.cost is distinct from old.cost then raise exception 'product cost accounting has been retired';
  end if;
  return new;
end;
$$;
revoke all on function private.retire_product_cost() from public, anon, authenticated;
create trigger retire_product_cost before insert or update of cost on public.products
for each row execute function private.retire_product_cost();
revoke all on function public.get_admin_product_costs() from public, anon, authenticated;
revoke all on function public.set_admin_product_cost(uuid,numeric) from public, anon, authenticated;
notify pgrst, 'reload schema';
commit;
