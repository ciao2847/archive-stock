-- Simplified intake: work and storage location are optional. Existing work links stay intact.
begin;

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
  p_identifying_features text,
  p_owner_id uuid,
  p_description text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_role public.user_role;
  v_work_id uuid;
  v_location_id uuid;
  v_product_id uuid;
  v_cabinet text;
  v_shelf integer;
  v_bin integer;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;
  select public.my_role() into v_role;
  if v_role is null or v_role not in ('admin', 'staff') then
    raise exception 'employee access required';
  end if;
  if p_owner_id is null or (
    v_role <> 'admin'
    and p_owner_id is distinct from (select private.current_inventory_owner_id())
  ) then
    raise exception 'owner access required';
  end if;
  if nullif(trim(p_name), '') is null then
    raise exception 'product name is required';
  end if;
  if p_stock is null or p_stock < 0 or p_stock > 1000
    or p_price is null or p_price < 0
    or p_cost is null or p_cost < 0 then
    raise exception 'invalid product amount';
  end if;
  if nullif(trim(p_location), '') is not null
    and upper(trim(p_location)) !~ '^[A-Z]-[0-9]{2}-[0-9]{2}$' then
    raise exception 'invalid product location';
  end if;

  if nullif(trim(p_work), '') is not null then
    select work.id into v_work_id
    from public.works work
    where work.title_zh = trim(p_work)
    order by work.created_at
    limit 1;
    if v_work_id is null then
      insert into public.works(title_zh)
      values (trim(p_work))
      returning id into v_work_id;
    end if;

  end if;

  if nullif(trim(p_location), '') is not null then
    select location.id into v_location_id
    from public.locations location
    where location.owner_id = p_owner_id
      and location.code = upper(trim(p_location));
    if v_location_id is null then
      v_cabinet := split_part(upper(trim(p_location)), '-', 1);
      v_shelf := split_part(upper(trim(p_location)), '-', 2)::integer;
      v_bin := split_part(upper(trim(p_location)), '-', 3)::integer;
      insert into public.locations(owner_id, code, cabinet, shelf, bin)
      values (
        p_owner_id,
        upper(trim(p_location)),
        v_cabinet,
        v_shelf,
        v_bin
      )
      returning id into v_location_id;
    end if;
  end if;

  insert into public.products(
    owner_id,
    name,
    category,
    work_id,
    country,
    source,
    location_id,
    stock,
    status,
    price,
    cost,
    image_paths,
    poster_format,
    poster_size,
    poster_crafts,
    identifying_features,
    description,
    created_by
  )
  values (
    p_owner_id,
    trim(p_name),
    p_category,
    v_work_id,
    nullif(trim(p_country), ''),
    nullif(trim(p_source), ''),
    v_location_id,
    p_stock,
    case
      when p_stock = 0 then 'packed'::public.product_status
      else 'in_stock'::public.product_status
    end,
    p_price,
    p_cost,
    coalesce(p_image_paths, '{}'),
    nullif(p_poster_format, ''),
    nullif(p_poster_size, ''),
    coalesce(p_poster_crafts, '{}'),
    nullif(trim(p_identifying_features), ''),
    nullif(p_description, ''),
    (select auth.uid())
  )
  returning id into v_product_id;

  insert into public.product_qr_labels(product_id, batch_code)
  select v_product_id, to_char(current_date, 'YYYYMMDD')
  from generate_series(1, p_stock);

  return v_product_id;
end;
$$;


commit;
