-- Cabinet tabs use complete row/column grids. Existing poster locations are reset ONCE.
-- Run the whole file after cabinet_location_management. Re-running does not clear new putaway records.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '120s';
lock table public.storage_cabinets, public.locations, public.products, public.product_location_stocks in exclusive mode;

create table if not exists private.cabinet_maintenance_runs (
  operation text primary key,
  completed_at timestamptz not null default now(),
  cleared_primary_locations bigint not null,
  cleared_allocations bigint not null,
  preserved_products bigint not null
);
alter table private.cabinet_maintenance_runs enable row level security;
revoke all on private.cabinet_maintenance_runs from public,anon,authenticated;

create temporary table cabinet_grid_products_before on commit drop as
select id, to_jsonb(p)-'location_id'-'updated_at' as product_data from public.products p;

create or replace function private.manage_location_storage(p_owner_id uuid,p_action text,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_c public.storage_cabinets; v_l public.locations; v_p public.products; v_id uuid;
 v_rows integer; v_columns integer; v_code text; v_i integer; v_j integer; v_item jsonb;
 v_quantity integer; v_available integer; v_from uuid; v_name text;
begin
  if (select auth.uid()) is null or coalesce((select public.my_role())::text,'') not in ('admin','staff')
    or p_owner_id is null or ((select public.my_role()) <> 'admin' and p_owner_id is distinct from (select private.current_inventory_owner_id()))
    then raise exception 'owner access required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('storage:'||p_owner_id::text,0));
  if p_action in ('create_cabinet','resize_cabinet','add_slot') then
    if p_action='create_cabinet' then
      select chr(n) into v_code from generate_series(65,90) n
      where not exists(select 1 from public.storage_cabinets where owner_id=p_owner_id and code=chr(n))
      and not exists(select 1 from public.locations where owner_id=p_owner_id and cabinet=chr(n)) order by n limit 1;
      if v_code is null then raise exception 'no cabinet code available'; end if;
      v_rows:=(p_input->>'rows')::integer; v_columns:=(p_input->>'columns')::integer;
      v_name:=trim(p_input->>'name');
      if v_rows not between 1 and 99 or v_columns not between 1 and 99 or v_rows is null or v_columns is null or coalesce(length(v_name),0) not between 1 and 100 then raise exception 'invalid cabinet size'; end if;
      insert into public.storage_cabinets(owner_id,name,code,rows,columns) values(p_owner_id,v_name,v_code,v_rows,v_columns) returning * into v_c;
    else
      select * into v_c from public.storage_cabinets where id=(p_input->>'id')::uuid and owner_id=p_owner_id for update;
      if not found then raise exception 'owner access required'; end if;
      if p_action='add_slot' then
        -- Repair holes, or grow by one complete column so the cabinet stays rectangular.
        if not exists (
          select 1 from generate_series(1,v_c.rows) r cross join generate_series(1,v_c.columns) b
          where not exists(select 1 from public.locations where cabinet_id=v_c.id and shelf=r and bin=b)
        ) then
          if v_c.columns >= 99 then raise exception 'invalid cabinet size'; end if;
          update public.storage_cabinets set columns=columns+1 where id=v_c.id returning * into v_c;
        end if;
      else
      v_rows:=(p_input->>'rows')::integer; v_columns:=(p_input->>'columns')::integer; v_name:=trim(p_input->>'name');
      if v_rows not between 1 and 99 or v_columns not between 1 and 99 or v_rows is null or v_columns is null or coalesce(length(v_name),0) not between 1 and 100 then raise exception 'invalid cabinet size'; end if;
      if exists(select 1 from public.locations l where l.cabinet_id=v_c.id and (l.shelf>v_rows or l.bin>v_columns)
        and (exists(select 1 from public.product_location_stocks where location_id=l.id) or exists(select 1 from public.products where location_id=l.id)
         or exists(select 1 from public.location_movements where from_location_id=l.id or to_location_id=l.id))) then raise exception 'occupied slot'; end if;
      delete from public.locations where cabinet_id=v_c.id and (shelf>v_rows or bin>v_columns);
      update public.storage_cabinets set name=v_name,rows=v_rows,columns=v_columns where id=v_c.id returning * into v_c;
      end if;
    end if;
    for v_i in 1..v_c.rows loop for v_j in 1..v_c.columns loop
      insert into public.locations(owner_id,cabinet_id,code,cabinet,shelf,bin,display_name)
      values(p_owner_id,v_c.id,v_c.code||'-'||lpad(v_i::text,2,'0')||'-'||lpad(v_j::text,2,'0'),v_c.code,v_i,v_j,'新庫位')
      on conflict(owner_id,code) do update set cabinet_id=excluded.cabinet_id;
    end loop; end loop;
    return to_jsonb(v_c);
  elsif p_action in ('rename_slot','delete_slot') then
    select * into v_l from public.locations where id=(p_input->>'id')::uuid and owner_id=p_owner_id for update;
    if not found then raise exception 'owner access required'; end if;
    if p_action='rename_slot' then
      v_name:=trim(p_input->>'name'); if coalesce(length(v_name),0) not between 1 and 100 then raise exception 'invalid slot name'; end if;
      update public.locations set display_name=v_name where id=v_l.id;
    else
      if exists(select 1 from public.product_location_stocks where location_id=v_l.id) or exists(select 1 from public.products where location_id=v_l.id)
        or exists(select 1 from public.location_movements where from_location_id=v_l.id or to_location_id=v_l.id) then raise exception 'occupied slot'; end if;
      delete from public.locations where id=v_l.id;
    end if;
    return jsonb_build_object('id',v_l.id);
  elsif p_action='putaway' then
    select * into v_l from public.locations where id=(p_input->>'locationId')::uuid and owner_id=p_owner_id for update;
    if not found then raise exception 'owner access required'; end if;
    if jsonb_typeof(p_input->'items') <> 'array' or jsonb_array_length(p_input->'items') not between 1 and 100 then raise exception 'invalid items'; end if;
    if (select count(*) <> count(distinct x->>'productId') from jsonb_array_elements(p_input->'items') x) then raise exception 'duplicate product'; end if;
    for v_item in select x from jsonb_array_elements(p_input->'items') x order by x->>'productId' loop
      select * into v_p from public.products where id=(v_item->>'productId')::uuid and owner_id=p_owner_id for update;
      if not found then raise exception 'owner access required'; end if;
      v_quantity:=(v_item->>'quantity')::integer; v_from:=(v_item->>'fromLocationId')::uuid;
      if v_quantity is null or v_quantity not between 1 and 1000 then raise exception 'invalid quantity'; end if;
      if v_from is null then
        select v_p.stock-coalesce(sum(quantity),0) into v_available from public.product_location_stocks where product_id=v_p.id;
        if v_quantity>v_available then raise exception 'quantity exceeds unassigned stock'; end if;
      else
        if v_from=v_l.id then raise exception 'same source and destination'; end if;
        select quantity into v_available from public.product_location_stocks where product_id=v_p.id and location_id=v_from and owner_id=p_owner_id for update;
        if v_available is null or v_quantity>v_available then raise exception 'quantity exceeds source stock'; end if;
        if v_quantity=v_available then delete from public.product_location_stocks where product_id=v_p.id and location_id=v_from;
        else update public.product_location_stocks set quantity=quantity-v_quantity where product_id=v_p.id and location_id=v_from; end if;
      end if;
      insert into public.product_location_stocks values(v_p.id,v_l.id,p_owner_id,v_quantity)
      on conflict(product_id,location_id) do update set quantity=public.product_location_stocks.quantity+excluded.quantity;
    end loop;
    return jsonb_build_object('updated',true);
  elsif p_action='quick_add' then
    v_quantity:=(p_input->>'quantity')::integer;
    if v_quantity is null or v_quantity not between 1 and 1000 or nullif(trim(p_input->>'country'),'') is null then raise exception 'invalid quantity'; end if;
    if nullif(p_input->>'locationId','') is not null then
      select * into v_l from public.locations where id=(p_input->>'locationId')::uuid and owner_id=p_owner_id;
      if not found then raise exception 'owner access required'; end if;
    end if;
    v_id:=public.create_inventory_product(p_input->>'name',null,'海報',p_input->>'country','',coalesce(v_l.code,''),v_quantity,(p_input->>'price')::numeric,0,'{}','','','{}','',p_owner_id,'');
    return jsonb_build_object('id',v_id);
  else raise exception 'invalid storage action'; end if;
end; $$;
revoke all on function private.manage_location_storage(uuid,text,jsonb) from public,anon;
grant execute on function private.manage_location_storage(uuid,text,jsonb) to authenticated;

do $maintenance$
declare v_primary bigint; v_allocations bigint; v_products bigint;
begin
  if exists(select 1 from private.cabinet_maintenance_runs where operation='20261008073128-switchable-cabinet-grids') then
    raise notice 'Cabinet setup/reset already completed; preserving subsequent putaway records';
    return;
  end if;

  -- 依照指示清理未命名的佔位格子「新庫位」（櫃子格位先留空待後續安排），保留自定義名稱之格位與櫃子
  delete from public.locations
  where display_name = '新庫位'
    and not exists (select 1 from public.product_location_stocks where location_id = locations.id)
    and not exists (select 1 from public.products where location_id = locations.id)
    and not exists (select 1 from public.location_movements where from_location_id = locations.id or to_location_id = locations.id);

  select count(*) into v_primary from public.products where location_id is not null;
  select count(*) into v_allocations from public.product_location_stocks;
  select count(*) into v_products from public.products;
  update public.products set location_id=null where location_id is not null;
  delete from public.product_location_stocks;

  if exists(select 1 from public.products p full join cabinet_grid_products_before b on b.id=p.id
    where p.id is null or b.id is null or (to_jsonb(p)-'location_id'-'updated_at') is distinct from b.product_data)
    then raise exception 'Reset aborted: product data or stock changed'; end if;
  if exists(select 1 from public.products where location_id is not null) or exists(select 1 from public.product_location_stocks)
    then raise exception 'Reset aborted: location assignments remain'; end if;

  insert into private.cabinet_maintenance_runs(operation,cleared_primary_locations,cleared_allocations,preserved_products)
  values('20261008073128-switchable-cabinet-grids',v_primary,v_allocations,v_products);
  raise notice 'Reset complete: % primary locations, % slot allocations cleared; % products preserved',v_primary,v_allocations,v_products;
end $maintenance$;
notify pgrst, 'reload schema';
commit;
