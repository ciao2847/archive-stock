begin;
create table public.storage_cabinets (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.inventory_databases(id),
  name text not null check(length(trim(name)) between 1 and 100), code text not null,
  rows integer not null check(rows between 1 and 99), columns integer not null check(columns between 1 and 99),
  created_at timestamptz not null default now(), unique(owner_id,code)
);
alter table public.storage_cabinets enable row level security;
create policy "inventory reads cabinets" on public.storage_cabinets for select to authenticated
using(owner_id = (select private.current_inventory_owner_id()) or (select public.my_role()) = 'admin');
revoke all on public.storage_cabinets from authenticated;
grant select on public.storage_cabinets to authenticated;
revoke all on public.storage_cabinets from anon;
alter table public.locations add column cabinet_id uuid references public.storage_cabinets(id);
alter table public.locations add column display_name text check(display_name is null or length(trim(display_name)) between 1 and 100);
create index locations_cabinet_id_idx on public.locations(cabinet_id);
insert into public.storage_cabinets(owner_id,name,code,rows,columns)
select owner_id,coalesce(nullif(cabinet,''),'A') || ' 櫃',coalesce(nullif(cabinet,''),'A'),
 greatest(1,coalesce(max(shelf),1)),greatest(1,coalesce(max(bin),1))
from public.locations group by owner_id,coalesce(nullif(cabinet,''),'A');
update public.locations l set cabinet_id=c.id,display_name=left(coalesce(nullif(l.description,''),l.code),100)
from public.storage_cabinets c where c.owner_id=l.owner_id and c.code=coalesce(nullif(l.cabinet,''),'A');

-- Existing/manual location RPCs can still create slots; attach them to their cabinet.
create function private.prepare_storage_slot() returns trigger language plpgsql security definer set search_path='' as $$
declare v_c public.storage_cabinets;
begin
  if new.cabinet_id is null then
    insert into public.storage_cabinets(owner_id,name,code,rows,columns)
    values(new.owner_id,coalesce(nullif(new.cabinet,''),'A')||' 櫃',coalesce(nullif(new.cabinet,''),'A'),greatest(1,coalesce(new.shelf,1)),greatest(1,coalesce(new.bin,1)))
    on conflict(owner_id,code) do update set rows=greatest(public.storage_cabinets.rows,excluded.rows),columns=greatest(public.storage_cabinets.columns,excluded.columns)
    returning * into v_c;
    new.cabinet_id:=v_c.id;
  elsif not exists(select 1 from public.storage_cabinets where id=new.cabinet_id and owner_id=new.owner_id) then
    raise exception 'owner access required';
  end if;
  new.display_name:=coalesce(nullif(trim(new.display_name),''),left(coalesce(nullif(new.description,''),new.code),100));
  return new;
end; $$;
revoke all on function private.prepare_storage_slot() from public,anon,authenticated;
create trigger prepare_storage_slot before insert or update of cabinet_id,owner_id on public.locations
for each row execute function private.prepare_storage_slot();

create table public.product_location_stocks (
  product_id uuid not null references public.products(id) on delete cascade,
  location_id uuid not null references public.locations(id),
  owner_id uuid not null references public.inventory_databases(id), quantity integer not null check(quantity > 0),
  primary key(product_id,location_id)
);
create index product_location_stocks_location_id_idx on public.product_location_stocks(location_id);
create index product_location_stocks_owner_id_idx on public.product_location_stocks(owner_id);
alter table public.product_location_stocks enable row level security;
create policy "inventory reads allocated stock" on public.product_location_stocks for select to authenticated
using(owner_id = (select private.current_inventory_owner_id()) or (select public.my_role()) = 'admin');
revoke all on public.product_location_stocks from authenticated;
grant select on public.product_location_stocks to authenticated;
revoke all on public.product_location_stocks from anon;
insert into public.product_location_stocks(product_id,location_id,owner_id,quantity)
select id,location_id,owner_id,stock from public.products where location_id is not null and stock > 0;

-- Keep allocations bounded when existing inventory/order RPCs change physical stock.
-- Increasing stock goes to the legacy primary location, otherwise stays unassigned.
create function private.sync_product_location_stock() returns trigger language plpgsql security definer set search_path='' as $$
declare v_excess integer; v_row record; v_remove integer;
begin
  if tg_op='INSERT' then
    if new.location_id is not null and new.stock > 0 then
      insert into public.product_location_stocks values(new.id,new.location_id,new.owner_id,new.stock);
    end if;
    return new;
  end if;
  if new.owner_id is distinct from old.owner_id then
    raise exception 'allocated inventory owner cannot be changed';
  end if;
  if new.location_id is distinct from old.location_id then
    delete from public.product_location_stocks where product_id=new.id;
    if new.location_id is not null and new.stock > 0 then
      insert into public.product_location_stocks values(new.id,new.location_id,new.owner_id,new.stock);
    end if;
  elsif new.stock > old.stock and new.location_id is not null then
    insert into public.product_location_stocks values(new.id,new.location_id,new.owner_id,new.stock-old.stock)
    on conflict(product_id,location_id) do update set quantity=public.product_location_stocks.quantity+excluded.quantity;
  else
    select coalesce(sum(quantity),0)-new.stock into v_excess from public.product_location_stocks where product_id=new.id;
    for v_row in select * from public.product_location_stocks where product_id=new.id
      order by (location_id=new.location_id) desc nulls last,location_id for update loop
      exit when v_excess <= 0;
      v_remove:=least(v_excess,v_row.quantity);
      if v_remove=v_row.quantity then delete from public.product_location_stocks where product_id=new.id and location_id=v_row.location_id;
      else update public.product_location_stocks set quantity=quantity-v_remove where product_id=new.id and location_id=v_row.location_id; end if;
      v_excess:=v_excess-v_remove;
    end loop;
  end if;
  return new;
end; $$;
revoke all on function private.sync_product_location_stock() from public,anon,authenticated;
create trigger sync_product_location_stock after insert or update of stock,location_id,owner_id on public.products
for each row execute function private.sync_product_location_stock();

create function private.manage_location_storage(p_owner_id uuid,p_action text,p_input jsonb)
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
      if v_rows not between 1 and 10 or v_columns not between 1 and 10 or v_rows is null or v_columns is null or coalesce(length(v_name),0) not between 1 and 100 then raise exception 'invalid cabinet size'; end if;
      insert into public.storage_cabinets(owner_id,name,code,rows,columns) values(p_owner_id,v_name,v_code,v_rows,v_columns) returning * into v_c;
    else
      select * into v_c from public.storage_cabinets where id=(p_input->>'id')::uuid and owner_id=p_owner_id for update;
      if not found then raise exception 'owner access required'; end if;
      if p_action='add_slot' then
        select r,b into v_i,v_j from generate_series(1,v_c.rows) r cross join generate_series(1,v_c.columns) b
        where not exists(select 1 from public.locations where cabinet_id=v_c.id and shelf=r and bin=b) order by r,b limit 1;
        if v_i is null then
          if v_c.rows >= 10 then raise exception 'invalid cabinet size'; end if;
          update public.storage_cabinets set rows=rows+1 where id=v_c.id returning * into v_c;
          v_i:=v_c.rows; v_j:=1;
        end if;
        insert into public.locations(owner_id,cabinet_id,code,cabinet,shelf,bin,display_name)
        values(p_owner_id,v_c.id,v_c.code||'-'||lpad(v_i::text,2,'0')||'-'||lpad(v_j::text,2,'0'),v_c.code,v_i,v_j,'新庫位') returning id into v_id;
        return jsonb_build_object('id',v_id);
      end if;
      v_rows:=(p_input->>'rows')::integer; v_columns:=(p_input->>'columns')::integer; v_name:=trim(p_input->>'name');
      if v_rows not between 1 and 10 or v_columns not between 1 and 10 or v_rows is null or v_columns is null or coalesce(length(v_name),0) not between 1 and 100 then raise exception 'invalid cabinet size'; end if;
      if exists(select 1 from public.locations l where l.cabinet_id=v_c.id and (l.shelf>v_rows or l.bin>v_columns)
        and (exists(select 1 from public.product_location_stocks where location_id=l.id) or exists(select 1 from public.products where location_id=l.id)
         or exists(select 1 from public.location_movements where from_location_id=l.id or to_location_id=l.id))) then raise exception 'occupied slot'; end if;
      delete from public.locations where cabinet_id=v_c.id and (shelf>v_rows or bin>v_columns);
      update public.storage_cabinets set name=v_name,rows=v_rows,columns=v_columns where id=v_c.id returning * into v_c;
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
create function public.manage_location_storage(p_owner_id uuid,p_action text,p_input jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.manage_location_storage(p_owner_id,p_action,p_input)$$;
revoke all on function public.manage_location_storage(uuid,text,jsonb) from public,anon;
grant execute on function public.manage_location_storage(uuid,text,jsonb) to authenticated;
commit;
