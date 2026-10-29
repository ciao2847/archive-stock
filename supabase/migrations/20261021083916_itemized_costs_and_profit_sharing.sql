begin;

-- Details share the existing period row, revision lock, member RLS and settlement lock.
alter table public.financial_period_costs
  add column cost_entries jsonb not null default '[]'::jsonb,
  add column share_rules jsonb not null default '[]'::jsonb;
alter table public.financial_period_cost_revisions
  add column cost_entries jsonb not null default '[]'::jsonb,
  add column share_rules jsonb not null default '[]'::jsonb;

create function private.validate_financial_period_details() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare v_entry jsonb; v_share jsonb; v_total numeric := 0; v_ratio numeric := 0;
begin
  if jsonb_typeof(new.cost_entries) <> 'array' or jsonb_array_length(new.cost_entries) > 500
    or jsonb_typeof(new.share_rules) <> 'array' or jsonb_array_length(new.share_rules) > 20 then
    raise exception 'invalid financial details';
  end if;
  for v_entry in select value from jsonb_array_elements(new.cost_entries) loop
    if jsonb_typeof(v_entry) <> 'object' or not (v_entry ?& array['id','date','category','name','amount','notes'])
      or jsonb_typeof(v_entry->'amount') <> 'number'
      or exists(select 1 from unnest(array['id','date','category','name','notes']) k where jsonb_typeof(v_entry->k) is distinct from 'string')
      or coalesce(v_entry->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(v_entry->>'date','') !~ '^\d{4}-\d{2}-\d{2}$'
      or (v_entry->>'date')::date not between new.period_start and new.period_end
      or (v_entry->>'category') not in ('商品購入','國際運費','國內運費','平台費','包材','其他')
      or length(btrim(v_entry->>'name')) not between 1 and 200
      or length(v_entry->>'notes') > 1000
      or (v_entry->>'amount')::numeric < 0
      or (v_entry->>'amount')::numeric > 999999999999.99
      or (v_entry->>'amount')::numeric <> round((v_entry->>'amount')::numeric,2) then
      raise exception 'invalid financial details';
    end if;
    v_total := v_total + (v_entry->>'amount')::numeric;
  end loop;
  if jsonb_array_length(new.cost_entries) > 0 and new.amount <> v_total then raise exception 'cost detail total mismatch'; end if;
  if (select count(*) <> count(distinct value->>'id') from jsonb_array_elements(new.cost_entries)) then raise exception 'invalid financial details'; end if;
  for v_share in select value from jsonb_array_elements(new.share_rules) loop
    if jsonb_typeof(v_share) <> 'object' or not (v_share ?& array['id','name','basisPoints'])
      or exists(select 1 from unnest(array['id','name']) k where jsonb_typeof(v_share->k) is distinct from 'string')
      or coalesce(v_share->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or length(btrim(v_share->>'name')) not between 1 and 100
      or jsonb_typeof(v_share->'basisPoints') <> 'number'
      or (v_share->>'basisPoints')::numeric not between 1 and 10000
      or (v_share->>'basisPoints')::numeric <> trunc((v_share->>'basisPoints')::numeric) then
      raise exception 'invalid profit shares';
    end if;
    v_ratio := v_ratio + (v_share->>'basisPoints')::numeric;
  end loop;
  if jsonb_array_length(new.share_rules) > 0 and v_ratio <> 10000 then raise exception 'profit shares must total 100 percent'; end if;
  if (select count(*) <> count(distinct value->>'id') or count(*) <> count(distinct btrim(value->>'name')) from jsonb_array_elements(new.share_rules)) then raise exception 'invalid profit shares'; end if;
  return new;
end;
$$;
revoke all on function private.validate_financial_period_details() from public,anon,authenticated;
create trigger validate_financial_period_details before insert or update on public.financial_period_costs
for each row execute function private.validate_financial_period_details();

-- Include details in every audited revision, with the same existing authorization.
create or replace function private.record_period_cost_revision() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or new.updated_by is distinct from (select auth.uid())
    or coalesce((select public.my_role())::text,'') not in ('admin','staff')
    or (new.owner_id is distinct from (select private.current_inventory_owner_id())
      and (select public.my_role()) <> 'admin') then raise exception 'owner access required'; end if;
  insert into public.financial_period_cost_revisions(cost_id,revision,owner_id,amount,
    calculator_path,evidence_paths,notes,changed_by,cost_entries,share_rules)
  values(new.id,new.revision,new.owner_id,new.amount,new.calculator_path,
    new.evidence_paths,new.notes,new.updated_by,new.cost_entries,new.share_rules);
  return new;
end;
$$;

create function public.save_financial_period_details(
  p_owner_id uuid, p_start date, p_end date, p_entries jsonb,
  p_shares jsonb, p_notes text, p_expected_revision integer
) returns public.financial_period_costs
language plpgsql security invoker set search_path = '' as $$
declare v_cost public.financial_period_costs; v_amount numeric;
begin
  if (select auth.uid()) is null or coalesce((select public.my_role())::text,'') not in ('admin','staff')
    or p_owner_id is null or (p_owner_id is distinct from (select private.current_inventory_owner_id())
      and (select public.my_role()) <> 'admin') then raise exception 'owner access required'; end if;
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' or p_shares is null or jsonb_typeof(p_shares) <> 'array' then raise exception 'invalid financial details'; end if;
  if p_start is null or p_end is null or extract(year from p_start) not between 2000 and 2100
    or extract(day from p_start) <> 1 or extract(month from p_start)::integer % 2 <> 1
    or p_end <> (p_start + interval '2 months - 1 day')::date then raise exception 'invalid period dates'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner_id::text || p_start::text,0));
  select * into v_cost from public.financial_period_costs where owner_id=p_owner_id and period_start=p_start for update;
  if p_expected_revision is distinct from coalesce(v_cost.revision,0) then raise exception 'period cost was changed; reload'; end if;
  select coalesce(sum((value->>'amount')::numeric),0) into v_amount from jsonb_array_elements(p_entries);
  if v_amount < 0 or v_amount > 999999999999.99 then raise exception 'invalid period amount'; end if;
  if v_cost.id is null then
    insert into public.financial_period_costs(owner_id,period_start,period_end,amount,notes,created_by,updated_by,cost_entries,share_rules)
    values(p_owner_id,p_start,p_end,v_amount,coalesce(p_notes,''),(select auth.uid()),(select auth.uid()),p_entries,p_shares)
    returning * into v_cost;
  else
    update public.financial_period_costs set amount=v_amount,notes=coalesce(p_notes,''),cost_entries=p_entries,share_rules=p_shares
    where id=v_cost.id and period_end=p_end returning * into v_cost;
    if not found then raise exception 'invalid period dates'; end if;
  end if;
  return v_cost;
end;
$$;
revoke all on function public.save_financial_period_details(uuid,date,date,jsonb,jsonb,text,integer) from public,anon;
grant execute on function public.save_financial_period_details(uuid,date,date,jsonb,jsonb,text,integer) to authenticated;

-- One transaction locks the same period as saving and settling: exports never mix revisions.
create function public.get_financial_period_report(p_owner_id uuid,p_start date,p_end date)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_preview jsonb; v_cost public.financial_period_costs; v_settlement public.settlements; v_orders jsonb;
begin
  -- The preview function validates both authorization and period dates.
  v_preview := public.get_financial_period_preview(p_owner_id,p_start,p_end);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner_id::text || p_start::text,0));
  v_preview := public.get_financial_period_preview(p_owner_id,p_start,p_end);
  select * into v_cost from public.financial_period_costs where owner_id=p_owner_id and period_start=p_start;
  select * into v_settlement from public.settlements where owner_id=p_owner_id and period_start=p_start and period_end=p_end and cost_source='period_total';
  select coalesce(jsonb_agg(x.row order by x.order_date,x.order_id),'[]'::jsonb) into v_orders from (
    select o.id as order_id,coalesce(o.packed_at,o.created_at) as order_date,
      jsonb_build_object('orderId',o.id,'orderNo',o.order_no,
        'date',to_char(coalesce(o.packed_at,o.created_at) at time zone 'Asia/Taipei','YYYY-MM-DD'),
        'customer',coalesce(c.nickname,c.name,''),'status',o.status,'discount',o.discount,
        'revenue',case when v_settlement.id is not null then
          (select revenue from public.settlement_orders where settlement_id=v_settlement.id and order_id=o.id)
          else coalesce((select sum(quantity*unit_price) from public.order_items where order_id=o.id),0)-o.discount end,
        'items',coalesce((select jsonb_agg(jsonb_build_object('sku',p.sku,'name',p.name,'quantity',oi.quantity,'unitPrice',oi.unit_price) order by oi.id) from public.order_items oi join public.products p on p.id=oi.product_id where oi.order_id=o.id),'[]'::jsonb)) as row
    from public.orders o left join public.customers c on c.id=o.customer_id
    where o.owner_id=p_owner_id and (
      (v_settlement.id is not null and exists(select 1 from public.settlement_orders so where so.settlement_id=v_settlement.id and so.order_id=o.id))
      or (v_settlement.id is null and o.deleted_at is null and o.status in ('packed','shipped')
        and (coalesce(o.packed_at,o.created_at) at time zone 'Asia/Taipei')::date between p_start and p_end
        and not exists(select 1 from public.settlement_orders so where so.order_id=o.id))
    )
  ) x;
  return jsonb_build_object('period',jsonb_build_object('start',p_start,'end',p_end),'cost',case when v_cost.id is null then null else to_jsonb(v_cost) end,
    'preview',v_preview,'settlementNo',v_settlement.settlement_no,'orders',v_orders);
end;
$$;
revoke all on function public.get_financial_period_report(uuid,date,date) from public,anon;
grant execute on function public.get_financial_period_report(uuid,date,date) to authenticated;
-- Enumerate only this inventory's saved periods for a complete multi-period workbook.
create function public.get_financial_report_periods(p_owner_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  if (select auth.uid()) is null or coalesce((select public.my_role())::text,'') not in ('admin','staff')
    or p_owner_id is null or (p_owner_id is distinct from (select private.current_inventory_owner_id())
      and (select public.my_role()) <> 'admin') then raise exception 'owner access required'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('start',period_start,'end',period_end) order by period_start)
    from public.financial_period_costs where owner_id=p_owner_id),'[]'::jsonb);
end;
$$;
revoke all on function public.get_financial_report_periods(uuid) from public,anon;
grant execute on function public.get_financial_report_periods(uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
