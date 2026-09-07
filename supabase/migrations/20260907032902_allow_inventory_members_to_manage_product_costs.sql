begin;

-- Product row policies continue to enforce membership in the current inventory.
-- Explicit column privileges also cover databases with legacy cost restrictions.
grant select (cost), insert (cost), update (cost) on public.products to authenticated;

create or replace function public.create_inventory_product(
  p_name text, p_work text, p_category text, p_country text, p_source text,
  p_location text, p_stock integer, p_price numeric, p_cost numeric,
  p_image_paths text[], p_poster_format text, p_poster_size text,
  p_poster_crafts text[], p_identifying_features text, p_owner_id uuid
)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_work_id uuid; v_location_id uuid; v_product_id uuid;
  v_cabinet text; v_shelf integer; v_bin integer;
begin
  if (select public.my_role()) not in ('admin', 'staff') then raise exception 'employee access required'; end if;
  if p_owner_id is null or (
    (select public.my_role()) <> 'admin'
    and p_owner_id <> (select private.current_inventory_owner_id())
  ) then raise exception 'owner access required'; end if;
  if nullif(trim(p_name), '') is null or nullif(trim(p_work), '') is null then raise exception 'product and work names are required'; end if;
  if p_stock < 1 or p_stock > 1000 or p_price < 0 or p_cost < 0 then raise exception 'invalid product amount'; end if;
  select id into v_work_id from public.works where title_zh = trim(p_work) order by created_at limit 1;
  if v_work_id is null then insert into public.works(title_zh) values(trim(p_work)) returning id into v_work_id; end if;
  select id into v_location_id from public.locations where owner_id = p_owner_id and code = upper(trim(p_location));
  if v_location_id is null then
    v_cabinet := split_part(upper(trim(p_location)), '-', 1);
    v_shelf := split_part(upper(trim(p_location)), '-', 2)::integer;
    v_bin := split_part(upper(trim(p_location)), '-', 3)::integer;
    insert into public.locations(owner_id, code, cabinet, shelf, bin)
    values(p_owner_id, upper(trim(p_location)), v_cabinet, v_shelf, v_bin) returning id into v_location_id;
  end if;
  insert into public.products(
    owner_id, name, category, work_id, country, source, location_id, stock, price,
    cost, image_paths, poster_format, poster_size, poster_crafts,
    identifying_features, created_by
  ) values (
    p_owner_id, trim(p_name), p_category, v_work_id, nullif(trim(p_country), ''),
    nullif(trim(p_source), ''), v_location_id, p_stock, p_price, p_cost,
    coalesce(p_image_paths, '{}'), nullif(p_poster_format, ''),
    nullif(p_poster_size, ''), coalesce(p_poster_crafts, '{}'),
    nullif(trim(p_identifying_features), ''), (select auth.uid())
  ) returning id into v_product_id;
  insert into public.product_qr_labels(product_id, batch_code)
  select v_product_id, to_char(current_date, 'YYYYMMDD') from generate_series(1, p_stock);
  return v_product_id;
end;
$$;

-- Replace the old signature so PostgREST has only one unambiguous update RPC.
drop function public.update_inventory_product(uuid,text,text,text,text,text,integer,numeric,numeric,text,text,text);

create or replace function public.update_inventory_product(
  p_product_id uuid, p_name text, p_category text, p_country text,
  p_source text, p_location text, p_stock integer, p_price numeric,
  p_cost numeric, p_poster_format text, p_poster_size text,
  p_identifying_features text,
  p_work text default null, p_poster_crafts text[] default null,
  p_image_paths text[] default null
)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare
  v_work_id uuid;
  v_location_id uuid; v_existing_stock integer; v_owner_id uuid;
  v_cabinet text; v_shelf integer; v_bin integer;
begin
  if (select public.my_role()) not in ('admin', 'staff') then raise exception 'employee access required'; end if;
  if nullif(trim(p_name), '') is null or p_stock < 0 or p_price < 0 then raise exception 'invalid product data'; end if;
  if p_cost is not null and p_cost < 0 then raise exception 'invalid product cost'; end if;
  select stock,owner_id into v_existing_stock,v_owner_id from public.products where id=p_product_id for update;
  if not found then raise exception 'product not found'; end if;
  if p_work is not null then
    if nullif(trim(p_work), '') is null then raise exception 'work name is required'; end if;
    select id into v_work_id from public.works where title_zh=trim(p_work) order by created_at limit 1;
    if v_work_id is null then insert into public.works(title_zh) values(trim(p_work)) returning id into v_work_id; end if;
  end if;
  if nullif(trim(p_location), '') is not null then
    select id into v_location_id from public.locations
    where owner_id=v_owner_id and code=upper(trim(p_location));
    if v_location_id is null then
      v_cabinet := split_part(upper(trim(p_location)), '-', 1);
      v_shelf := split_part(upper(trim(p_location)), '-', 2)::integer;
      v_bin := split_part(upper(trim(p_location)), '-', 3)::integer;
      insert into public.locations(owner_id,code,cabinet,shelf,bin)
      values(v_owner_id,upper(trim(p_location)),v_cabinet,v_shelf,v_bin)
      returning id into v_location_id;
    end if;
  end if;
  if p_stock <> v_existing_stock then perform public.adjust_product_stock(p_product_id,p_stock); end if;
  update public.products set name=trim(p_name),category=p_category,
    work_id=coalesce(v_work_id,work_id),
    poster_crafts=coalesce(p_poster_crafts,poster_crafts),
    image_paths=coalesce(p_image_paths,image_paths),
    country=nullif(trim(p_country),''),source=nullif(trim(p_source),''),
    location_id=v_location_id,price=p_price,cost=coalesce(p_cost,cost),
    poster_format=nullif(p_poster_format,''),poster_size=nullif(p_poster_size,''),
    identifying_features=nullif(trim(p_identifying_features),''),updated_at=now()
  where id=p_product_id;
  return true;
end;
$$;

revoke all on function public.update_inventory_product(uuid,text,text,text,text,text,integer,numeric,numeric,text,text,text,text,text[],text[]) from public, anon;
grant execute on function public.update_inventory_product(uuid,text,text,text,text,text,integer,numeric,numeric,text,text,text,text,text[],text[]) to authenticated;
-- Stock adjustments insert/revoke QR labels in the same transaction.
-- Shared inventory members need the same scope on labels as on products.
drop policy if exists "product owners or admins read qr labels" on public.product_qr_labels;
create policy "product owners or admins read qr labels"
on public.product_qr_labels for select to authenticated
using (exists (
  select 1 from public.products p
  where p.id = product_qr_labels.product_id
    and (p.owner_id = (select private.current_inventory_owner_id())
      or (select public.my_role()) = 'admin')
))
;
drop policy if exists "product owners or admins create qr labels" on public.product_qr_labels;
create policy "product owners or admins create qr labels"
on public.product_qr_labels for insert to authenticated
with check (exists (
  select 1 from public.products p
  where p.id = product_qr_labels.product_id
    and (p.owner_id = (select private.current_inventory_owner_id())
      or (select public.my_role()) = 'admin')
))
;
drop policy if exists "product owners or admins update qr labels" on public.product_qr_labels;
create policy "product owners or admins update qr labels"
on public.product_qr_labels for update to authenticated
using (exists (
  select 1 from public.products p
  where p.id = product_qr_labels.product_id
    and (p.owner_id = (select private.current_inventory_owner_id())
      or (select public.my_role()) = 'admin')
))
with check (exists (
  select 1 from public.products p
  where p.id = product_qr_labels.product_id
    and (p.owner_id = (select private.current_inventory_owner_id())
      or (select public.my_role()) = 'admin')
))
;

notify pgrst, 'reload schema';
commit;
