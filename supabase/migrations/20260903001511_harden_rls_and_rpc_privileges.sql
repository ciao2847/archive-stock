-- Security hardening for the exposed public schema.
-- Existing migrations remain immutable; this migration is safe to apply after them.

-- Every Data API table must enforce RLS.
alter table public.profiles enable row level security;
alter table public.works enable row level security;
alter table public.locations enable row level security;
alter table public.products enable row level security;
alter table public.location_movements enable row level security;
alter table public.customers enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.packing_scans enable row level security;
alter table public.product_qr_labels enable row level security;
alter table public.settlements enable row level security;
alter table public.settlement_orders enable row level security;
alter table public.settlement_products enable row level security;

-- Resolve the caller role through a narrowly scoped helper.
create or replace function public.my_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select role
  from public.profiles
  where id = (select auth.uid())
$$;

revoke all on function public.my_role() from public, anon;
grant execute on function public.my_role() to authenticated;

-- A user may read their own profile; admins may read all profiles.
drop policy if exists "authenticated read profiles" on public.profiles;
drop policy if exists "employees read profiles" on public.profiles;
create policy "users read own profile or admins read all"
on public.profiles
for select
to authenticated
using (
  id = (select auth.uid())
  or (select public.my_role()) = 'admin'
);

-- Replace broad authenticated read policies with an employee role check.
drop policy if exists "team reads works" on public.works;
create policy "employees read works"
on public.works for select to authenticated
using ((select public.my_role()) in ('admin', 'staff'));

drop policy if exists "team reads locations" on public.locations;
create policy "employees read locations"
on public.locations for select to authenticated
using ((select public.my_role()) in ('admin', 'staff'));

drop policy if exists "team reads products" on public.products;
create policy "employees read products"
on public.products for select to authenticated
using ((select public.my_role()) in ('admin', 'staff'));

drop policy if exists "team reads qr labels" on public.product_qr_labels;
create policy "employees read qr labels"
on public.product_qr_labels for select to authenticated
using ((select public.my_role()) in ('admin', 'staff'));

-- Storage writes require a known employee. Deletes remain admin-only.
drop policy if exists "employees upload product images" on storage.objects;
create policy "employees upload product images"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'product-images'
  and (select public.my_role()) in ('admin', 'staff')
);

drop policy if exists "employees update product images" on storage.objects;
create policy "employees update product images"
on storage.objects for update to authenticated
using (
  bucket_id = 'product-images'
  and (select public.my_role()) in ('admin', 'staff')
)
with check (
  bucket_id = 'product-images'
  and (select public.my_role()) in ('admin', 'staff')
);

drop policy if exists "admins delete product images" on storage.objects;
create policy "admins delete product images"
on storage.objects for delete to authenticated
using (
  bucket_id = 'product-images'
  and (select public.my_role()) = 'admin'
);

drop policy if exists "employees delete own product images" on storage.objects;
create policy "employees delete own product images"
on storage.objects for delete to authenticated
using (
  bucket_id = 'product-images'
  and owner_id = (select auth.uid()::text)
  and (select public.my_role()) in ('admin', 'staff')
);

-- Stock updates and QR-label counts are committed atomically. Defining this
-- here makes the migration independent from historical manual install scripts.
create or replace function public.adjust_product_stock(
  p_product_id uuid,
  p_new_stock integer
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_current_stock integer;
  v_current_status public.product_status;
  v_difference integer;
  v_active_labels integer;
  v_revoked_labels integer;
begin
  if (select public.my_role()) not in ('admin', 'staff') then
    raise exception 'employee access required';
  end if;
  if p_new_stock is null or p_new_stock < 0 then
    raise exception 'stock must be a nonnegative integer';
  end if;

  select p.stock, p.status
  into v_current_stock, v_current_status
  from public.products p
  where p.id = p_product_id
  for update;
  if not found then raise exception 'product not found'; end if;

  v_difference := p_new_stock - v_current_stock;
  if v_difference > 0 then
    insert into public.product_qr_labels (product_id, batch_code)
    select p_product_id, 'ADJUST-' || to_char(current_date, 'YYYYMMDD')
    from generate_series(1, v_difference);
  elsif v_difference < 0 then
    select count(*)::integer into v_active_labels
    from public.product_qr_labels q
    where q.product_id = p_product_id and q.status = 'active';
    if v_active_labels < abs(v_difference) then
      raise exception 'not enough active qr labels';
    end if;

    update public.product_qr_labels q
    set status = 'revoked'
    where q.id in (
      select candidate.id
      from public.product_qr_labels candidate
      where candidate.product_id = p_product_id
        and candidate.status = 'active'
      order by candidate.created_at desc, candidate.id desc
      limit abs(v_difference)
      for update
    );
    get diagnostics v_revoked_labels = row_count;
    if v_revoked_labels <> abs(v_difference) then
      raise exception 'not enough active qr labels';
    end if;
  end if;

  update public.products
  set stock = p_new_stock,
      status = case
        when p_new_stock = 0 then 'packed'::public.product_status
        when v_current_status in ('packed', 'shipped')
          then 'in_stock'::public.product_status
        else v_current_status
      end,
      updated_at = now()
  where id = p_product_id;
  return p_new_stock;
end;
$$;

-- Revoke implicit PUBLIC/anon execution for every privileged RPC that exists.
-- Catalog lookup makes this safe when older optional features were not installed.
do $$
declare
  v_function regprocedure;
begin
  for v_function in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any(array[
        'adjust_product_stock', 'archive_order', 'complete_order_packing',
        'consume_product_qr', 'consume_product_sku',
        'create_financial_settlement', 'create_order_with_items',
        'delete_inventory_product', 'get_admin_product_costs',
        'set_admin_product_cost', 'update_order_details',
        'update_order_financials'
      ])
  loop
    execute format('revoke all on function %s from public, anon', v_function);
    execute format('grant execute on function %s to authenticated', v_function);
  end loop;
end;
$$;

-- The public QR landing RPC is intentionally the only anonymous RPC.
revoke all on function public.get_public_qr_landing(uuid, text) from public;
grant execute on function public.get_public_qr_landing(uuid, text)
to anon, authenticated;

-- PostgreSQL does not automatically index foreign-key columns.
create index if not exists products_work_id_idx
  on public.products (work_id);
create index if not exists products_location_id_idx
  on public.products (location_id);
create index if not exists products_created_by_idx
  on public.products (created_by);
create index if not exists location_movements_product_id_idx
  on public.location_movements (product_id);
create index if not exists location_movements_to_location_id_idx
  on public.location_movements (to_location_id);
create index if not exists orders_customer_id_idx
  on public.orders (customer_id);
create index if not exists orders_created_by_idx
  on public.orders (created_by);
create index if not exists order_items_order_id_idx
  on public.order_items (order_id);
create index if not exists order_items_product_id_idx
  on public.order_items (product_id);
create index if not exists packing_scans_order_id_idx
  on public.packing_scans (order_id);
create index if not exists packing_scans_product_id_idx
  on public.packing_scans (product_id);
create index if not exists product_qr_labels_product_id_idx
  on public.product_qr_labels (product_id);


-- Product creation is one transaction across works, locations, products and QR labels.
create or replace function public.create_inventory_product(
  p_name text,
  p_work text,
  p_category text,
  p_country text,
  p_source text,
  p_location text,
  p_stock integer,
  p_price numeric,
  p_cost numeric,
  p_image_paths text[],
  p_poster_format text,
  p_poster_size text,
  p_poster_crafts text[],
  p_identifying_features text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_work_id uuid;
  v_location_id uuid;
  v_product_id uuid;
  v_cabinet text;
  v_shelf integer;
  v_bin integer;
  v_batch_code text := to_char(current_date, 'YYYYMMDD');
begin
  if (select public.my_role()) not in ('admin', 'staff') then
    raise exception 'employee access required';
  end if;
  if nullif(trim(p_name), '') is null or nullif(trim(p_work), '') is null then
    raise exception 'product and work names are required';
  end if;
  if p_stock < 1 or p_stock > 1000 or p_price < 0 or p_cost < 0 then
    raise exception 'invalid product amount';
  end if;
  if p_cost > 0 and (select public.my_role()) <> 'admin' then
    raise exception 'admin access required for cost';
  end if;

  select id into v_work_id
  from public.works
  where title_zh = trim(p_work)
  order by created_at
  limit 1;

  if v_work_id is null then
    insert into public.works (title_zh)
    values (trim(p_work))
    returning id into v_work_id;
  end if;

  select id into v_location_id
  from public.locations
  where code = upper(trim(p_location));

  if v_location_id is null then
    v_cabinet := split_part(upper(trim(p_location)), '-', 1);
    v_shelf := split_part(upper(trim(p_location)), '-', 2)::integer;
    v_bin := split_part(upper(trim(p_location)), '-', 3)::integer;
    insert into public.locations (code, cabinet, shelf, bin)
    values (upper(trim(p_location)), v_cabinet, v_shelf, v_bin)
    returning id into v_location_id;
  end if;

  insert into public.products (
    name, category, work_id, country, source, location_id, stock, price, cost,
    image_paths, poster_format, poster_size, poster_crafts,
    identifying_features, created_by
  )
  values (
    trim(p_name), p_category, v_work_id, nullif(trim(p_country), ''),
    nullif(trim(p_source), ''), v_location_id, p_stock, p_price, p_cost,
    coalesce(p_image_paths, '{}'), nullif(p_poster_format, ''),
    nullif(p_poster_size, ''), coalesce(p_poster_crafts, '{}'),
    nullif(trim(p_identifying_features), ''), (select auth.uid())
  )
  returning id into v_product_id;

  insert into public.product_qr_labels (product_id, batch_code)
  select v_product_id, v_batch_code
  from generate_series(1, p_stock);

  return v_product_id;
end;
$$;

revoke all on function public.create_inventory_product(
  text, text, text, text, text, text, integer, numeric, numeric,
  text[], text, text, text[], text
) from public, anon;
grant execute on function public.create_inventory_product(
  text, text, text, text, text, text, integer, numeric, numeric,
  text[], text, text, text[], text
) to authenticated;

-- Product metadata, stock and cost changes are committed atomically.
create or replace function public.update_inventory_product(
  p_product_id uuid,
  p_name text,
  p_category text,
  p_country text,
  p_source text,
  p_location text,
  p_stock integer,
  p_price numeric,
  p_cost numeric,
  p_poster_format text,
  p_poster_size text,
  p_identifying_features text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_location_id uuid;
  v_existing_stock integer;
  v_cabinet text;
  v_shelf integer;
  v_bin integer;
begin
  if (select public.my_role()) not in ('admin', 'staff') then
    raise exception 'employee access required';
  end if;
  if nullif(trim(p_name), '') is null or p_stock < 0 or p_price < 0 then
    raise exception 'invalid product data';
  end if;
  if p_cost is not null and (p_cost < 0 or (select public.my_role()) <> 'admin') then
    raise exception 'admin access required for cost';
  end if;

  select stock into v_existing_stock
  from public.products
  where id = p_product_id
  for update;
  if not found then raise exception 'product not found'; end if;

  if nullif(trim(p_location), '') is not null then
    select id into v_location_id
    from public.locations
    where code = upper(trim(p_location));

    if v_location_id is null then
      v_cabinet := split_part(upper(trim(p_location)), '-', 1);
      v_shelf := split_part(upper(trim(p_location)), '-', 2)::integer;
      v_bin := split_part(upper(trim(p_location)), '-', 3)::integer;
      insert into public.locations (code, cabinet, shelf, bin)
      values (upper(trim(p_location)), v_cabinet, v_shelf, v_bin)
      returning id into v_location_id;
    end if;
  end if;

  if p_stock <> v_existing_stock then
    perform public.adjust_product_stock(p_product_id, p_stock);
  end if;

  update public.products
  set
    name = trim(p_name),
    category = p_category,
    country = nullif(trim(p_country), ''),
    source = nullif(trim(p_source), ''),
    location_id = v_location_id,
    price = p_price,
    cost = coalesce(p_cost, cost),
    poster_format = nullif(p_poster_format, ''),
    poster_size = nullif(p_poster_size, ''),
    identifying_features = nullif(trim(p_identifying_features), ''),
    updated_at = now()
  where id = p_product_id;

  return true;
end;
$$;

revoke all on function public.update_inventory_product(
  uuid, text, text, text, text, text, integer, numeric, numeric, text, text, text
) from public, anon;
grant execute on function public.update_inventory_product(
  uuid, text, text, text, text, text, integer, numeric, numeric, text, text, text
) to authenticated;

notify pgrst, 'reload schema';
