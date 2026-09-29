begin;

-- 1. Add appearance columns to inventory_databases so that the whole inventory shares one banner and theme
alter table public.inventory_databases
  add column if not exists claim_banner_image_path text null,
  add column if not exists claim_banner_position_x integer not null default 50,
  add column if not exists claim_banner_position_y integer not null default 50,
  add column if not exists claim_theme_primary_color text not null default '#5A87B1',
  add column if not exists claim_theme_background_color text not null default '#F3F7FB',
  add column if not exists claim_theme_surface_color text not null default '#FFFFFF',
  add column if not exists claim_theme_header_text_color text not null default '#172433';

-- 2. Add validation constraints on inventory_databases appearance columns
alter table public.inventory_databases
  drop constraint if exists inventory_databases_claim_banner_position_x_range,
  add constraint inventory_databases_claim_banner_position_x_range
    check (claim_banner_position_x between 0 and 100);

alter table public.inventory_databases
  drop constraint if exists inventory_databases_claim_banner_position_y_range,
  add constraint inventory_databases_claim_banner_position_y_range
    check (claim_banner_position_y between 0 and 100);

alter table public.inventory_databases
  drop constraint if exists inventory_databases_claim_theme_primary_color_format,
  add constraint inventory_databases_claim_theme_primary_color_format
    check (claim_theme_primary_color ~* '^#[0-9a-f]{6}$');

alter table public.inventory_databases
  drop constraint if exists inventory_databases_claim_theme_background_color_format,
  add constraint inventory_databases_claim_theme_background_color_format
    check (claim_theme_background_color ~* '^#[0-9a-f]{6}$');

alter table public.inventory_databases
  drop constraint if exists inventory_databases_claim_theme_surface_color_format,
  add constraint inventory_databases_claim_theme_surface_color_format
    check (claim_theme_surface_color ~* '^#[0-9a-f]{6}$');

alter table public.inventory_databases
  drop constraint if exists inventory_databases_claim_theme_header_text_color_format,
  add constraint inventory_databases_claim_theme_header_text_color_format
    check (claim_theme_header_text_color ~* '^#[0-9a-f]{6}$');

-- 3. Migrate existing appearance from claim_forms to inventory_databases
update public.inventory_databases inventory
set claim_banner_image_path = latest_form.banner_image_path,
    claim_banner_position_x = latest_form.banner_position_x,
    claim_banner_position_y = latest_form.banner_position_y,
    claim_theme_primary_color = latest_form.theme_primary_color,
    claim_theme_background_color = latest_form.theme_background_color,
    claim_theme_surface_color = latest_form.theme_surface_color,
    claim_theme_header_text_color = latest_form.theme_header_text_color
from (
  select distinct on (owner_id)
    owner_id,
    banner_image_path,
    banner_position_x,
    banner_position_y,
    theme_primary_color,
    theme_background_color,
    theme_surface_color,
    theme_header_text_color
  from public.claim_forms
  order by owner_id, created_at desc, id desc
) latest_form
where inventory.id = latest_form.owner_id;

-- Preset custom theme for 海報小天地 if banner is empty
update public.inventory_databases inventory
set claim_theme_primary_color = '#425F8F',
    claim_theme_background_color = '#E8EDF6',
    claim_theme_surface_color = '#FFF9EE',
    claim_theme_header_text_color = '#FFF9EE'
where inventory.name = '海報小天地'
  and inventory.claim_banner_image_path is null;

-- 4. Sync all existing claim forms under each inventory so they all share the inventory's unified appearance
update public.claim_forms form
set banner_image_path = inventory.claim_banner_image_path,
    banner_position_x = inventory.claim_banner_position_x,
    banner_position_y = inventory.claim_banner_position_y,
    theme_primary_color = inventory.claim_theme_primary_color,
    theme_background_color = inventory.claim_theme_background_color,
    theme_surface_color = inventory.claim_theme_surface_color,
    theme_header_text_color = inventory.claim_theme_header_text_color
from public.inventory_databases inventory
where inventory.id = form.owner_id;

-- 5. Privileged function to update the inventory appearance safely
drop function if exists private.update_inventory_claim_appearance(
  uuid, text, integer, integer, text, text, text, text
);

create or replace function private.update_inventory_claim_appearance(
  p_inventory_id uuid,
  p_banner_image_path text,
  p_banner_position_x integer,
  p_banner_position_y integer,
  p_theme_primary_color text,
  p_theme_background_color text,
  p_theme_surface_color text,
  p_theme_header_text_color text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.inventory_databases inventory
  set claim_banner_image_path = p_banner_image_path,
      claim_banner_position_x = p_banner_position_x,
      claim_banner_position_y = p_banner_position_y,
      claim_theme_primary_color = upper(p_theme_primary_color),
      claim_theme_background_color = upper(p_theme_background_color),
      claim_theme_surface_color = upper(p_theme_surface_color),
      claim_theme_header_text_color = upper(p_theme_header_text_color),
      updated_at = now()
  where inventory.id = p_inventory_id;
end;
$$;

revoke all on function private.update_inventory_claim_appearance(
  uuid, text, integer, integer, text, text, text, text
) from public, anon, authenticated;

-- 6. Replace configure_claim_form so that appearance updates the inventory and syncs to all IP claim forms
drop function if exists public.configure_claim_form(
  bigint, uuid, text, text, boolean, timestamptz, jsonb,
  text, integer, integer, text, text, text, text
);

create or replace function public.configure_claim_form(
  p_form_id bigint,
  p_owner_id uuid,
  p_title text,
  p_description text,
  p_is_open boolean,
  p_closes_at timestamptz,
  p_products jsonb,
  p_banner_image_path text,
  p_banner_position_x integer,
  p_banner_position_y integer,
  p_theme_primary_color text,
  p_theme_background_color text,
  p_theme_surface_color text,
  p_theme_header_text_color text
)
returns table(form_id bigint, public_token uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_role public.user_role;
  v_form_id bigint;
  v_public_token uuid;
  v_products jsonb := coalesce(p_products, '[]'::jsonb);
  v_product_ids uuid[] := array[]::uuid[];
  v_item jsonb;
  v_product_id uuid;
  v_display_name text;
  v_unit_price numeric;
  v_max_quantity integer;
  v_constraint_name text;
  v_banner_image_path text := nullif(trim(p_banner_image_path), '');
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
    and p_owner_id <> (select private.current_inventory_owner_id())
  ) then
    raise exception 'owner access required';
  end if;
  if nullif(trim(p_title), '') is null
    or char_length(trim(p_title)) > 120 then
    raise exception 'invalid claim form title';
  end if;
  if char_length(coalesce(p_description, '')) > 2000 then
    raise exception 'claim form description is too long';
  end if;
  if jsonb_typeof(v_products) <> 'array'
    or jsonb_array_length(v_products) > 200 then
    raise exception 'invalid claim form products';
  end if;

  if v_banner_image_path is not null and (
    char_length(v_banner_image_path) > 500
    or split_part(v_banner_image_path, '/', 1) <> p_owner_id::text
    or v_banner_image_path
      !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.webp$'
  ) then
    raise exception 'invalid claim form banner image';
  end if;

  if p_banner_position_x is null
    or p_banner_position_x not between 0 and 100
    or p_banner_position_y is null
    or p_banner_position_y not between 0 and 100
  then
    raise exception 'invalid claim form banner position';
  end if;

  if p_theme_primary_color is null
    or p_theme_primary_color !~ '^#[0-9A-Fa-f]{6}$'
    or p_theme_background_color is null
    or p_theme_background_color !~ '^#[0-9A-Fa-f]{6}$'
    or p_theme_surface_color is null
    or p_theme_surface_color !~ '^#[0-9A-Fa-f]{6}$'
    or p_theme_header_text_color is null
    or p_theme_header_text_color !~ '^#[0-9A-Fa-f]{6}$'
  then
    raise exception 'invalid claim form theme';
  end if;

  for v_item in select value from jsonb_array_elements(v_products) loop
    if coalesce(jsonb_typeof(v_item->'product_id'), 'null') <> 'string'
      or coalesce(jsonb_typeof(v_item->'name'), 'null') <> 'string'
      or coalesce(jsonb_typeof(v_item->'price'), 'null') <> 'number'
      or coalesce(jsonb_typeof(v_item->'max_quantity'), 'null') <> 'number'
    then
      raise exception 'invalid claim form product';
    end if;

    begin
      v_product_id := (v_item->>'product_id')::uuid;
      v_display_name := trim(v_item->>'name');
      v_unit_price := (v_item->>'price')::numeric;
      v_max_quantity := (v_item->>'max_quantity')::integer;
    exception when others then
      raise exception 'invalid claim form product';
    end;

    if v_product_id is null
      or v_display_name is null
      or char_length(v_display_name) not between 1 and 300
      or v_unit_price is null
      or v_unit_price < 0
      or v_unit_price > 9999999999.99
      or v_unit_price <> round(v_unit_price, 2)
      or v_max_quantity is null
      or v_max_quantity not between 1 and 99
      or v_product_id = any(v_product_ids)
    then
      raise exception 'invalid claim form product';
    end if;

    if not exists (
      select 1
      from public.products product
      where product.id = v_product_id
        and product.owner_id = p_owner_id
    ) then
      raise exception 'claim form product is not available';
    end if;

    v_product_ids := array_append(v_product_ids, v_product_id);
  end loop;

  -- Update the inventory-wide appearance
  perform private.update_inventory_claim_appearance(
    p_owner_id,
    v_banner_image_path,
    p_banner_position_x,
    p_banner_position_y,
    p_theme_primary_color,
    p_theme_background_color,
    p_theme_surface_color,
    p_theme_header_text_color
  );

  -- Upsert the target claim form
  begin
    if p_form_id is null then
      insert into public.claim_forms(
        owner_id,
        title,
        description,
        is_open,
        closes_at,
        created_by,
        banner_image_path,
        banner_position_x,
        banner_position_y,
        theme_primary_color,
        theme_background_color,
        theme_surface_color,
        theme_header_text_color
      )
      values (
        p_owner_id,
        trim(p_title),
        nullif(trim(p_description), ''),
        coalesce(p_is_open, false),
        p_closes_at,
        (select auth.uid()),
        v_banner_image_path,
        p_banner_position_x,
        p_banner_position_y,
        upper(p_theme_primary_color),
        upper(p_theme_background_color),
        upper(p_theme_surface_color),
        upper(p_theme_header_text_color)
      )
      returning claim_forms.id, claim_forms.public_token
        into v_form_id, v_public_token;
    else
      update public.claim_forms form
      set title = trim(p_title),
          description = nullif(trim(p_description), ''),
          is_open = coalesce(p_is_open, false),
          closes_at = p_closes_at,
          banner_image_path = v_banner_image_path,
          banner_position_x = p_banner_position_x,
          banner_position_y = p_banner_position_y,
          theme_primary_color = upper(p_theme_primary_color),
          theme_background_color = upper(p_theme_background_color),
          theme_surface_color = upper(p_theme_surface_color),
          theme_header_text_color = upper(p_theme_header_text_color),
          updated_at = now()
      where form.id = p_form_id
        and form.owner_id = p_owner_id
      returning form.id, form.public_token
        into v_form_id, v_public_token;

      if not found then
        raise exception 'claim form not found';
      end if;
    end if;
  exception when unique_violation then
    get stacked diagnostics v_constraint_name = constraint_name;
    if v_constraint_name in ('claim_forms_owner_title_unique_idx', 'claim_forms_owner_id_key') then
      raise exception 'claim form title already exists';
    end if;
    raise;
  end;

  -- Synchronize unified appearance across all other claim forms of this owner
  update public.claim_forms form
  set banner_image_path = v_banner_image_path,
      banner_position_x = p_banner_position_x,
      banner_position_y = p_banner_position_y,
      theme_primary_color = upper(p_theme_primary_color),
      theme_background_color = upper(p_theme_background_color),
      theme_surface_color = upper(p_theme_surface_color),
      theme_header_text_color = upper(p_theme_header_text_color),
      updated_at = now()
  where form.owner_id = p_owner_id
    and form.id <> v_form_id;

  -- Update products for this form
  delete from public.claim_form_products listing
  where listing.form_id = v_form_id
    and not (listing.product_id = any(v_product_ids));

  insert into public.claim_form_products(
    form_id,
    product_id,
    display_name,
    unit_price,
    max_quantity_per_customer,
    sort_order
  )
  select
    v_form_id,
    (requested.item->>'product_id')::uuid,
    trim(requested.item->>'name'),
    (requested.item->>'price')::numeric,
    (requested.item->>'max_quantity')::integer,
    requested.position - 1
  from jsonb_array_elements(v_products) with ordinality
    as requested(item, position)
  on conflict on constraint claim_form_products_pkey do update
  set display_name = excluded.display_name,
      unit_price = excluded.unit_price,
      max_quantity_per_customer = excluded.max_quantity_per_customer,
      sort_order = excluded.sort_order;

  return query select v_form_id, v_public_token;
end;
$$;

revoke all on function public.configure_claim_form(
  bigint, uuid, text, text, boolean, timestamptz, jsonb,
  text, integer, integer, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.configure_claim_form(
  bigint, uuid, text, text, boolean, timestamptz, jsonb,
  text, integer, integer, text, text, text, text
) to authenticated;

-- 7. Ensure get_public_claim_form always uses the inventory's unified appearance
drop function if exists public.get_public_claim_form(uuid);

create function public.get_public_claim_form(p_token uuid)
returns table(
  store_name text,
  title text,
  description text,
  is_open boolean,
  closes_at timestamptz,
  banner_image_path text,
  banner_position_x smallint,
  banner_position_y smallint,
  theme_primary_color text,
  theme_background_color text,
  theme_surface_color text,
  theme_header_text_color text,
  products jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(inventory.name, '庫藏預購'),
    form.title,
    form.description,
    form.is_open and (form.closes_at is null or form.closes_at > now()) as is_open,
    form.closes_at,
    coalesce(inventory.claim_banner_image_path, form.banner_image_path),
    coalesce(inventory.claim_banner_position_x, form.banner_position_x, 50)::smallint,
    coalesce(inventory.claim_banner_position_y, form.banner_position_y, 50)::smallint,
    coalesce(inventory.claim_theme_primary_color, form.theme_primary_color, '#5A87B1'),
    coalesce(inventory.claim_theme_background_color, form.theme_background_color, '#F3F7FB'),
    coalesce(inventory.claim_theme_surface_color, form.theme_surface_color, '#FFFFFF'),
    coalesce(inventory.claim_theme_header_text_color, form.theme_header_text_color, '#172433'),
    coalesce(
      (
        select jsonb_agg(listed_product.payload order by
          listed_product.sort_order,
          listed_product.published_at desc,
          listed_product.product_name
        )
        from (
          select
            listing.sort_order,
            listing.published_at,
            listing.display_name as product_name,
            jsonb_build_object(
              'id', product.id,
              'sku', product.sku,
              'name', listing.display_name,
              'work', work.title_zh,
              'category', product.category,
              'country', product.country,
              'source', product.source,
              'description', product.description,
              'price', listing.unit_price,
              'image_path', coalesce(
                product.image_paths[2],
                product.image_paths[1]
              ),
              'poster_format', product.poster_format,
              'poster_size', product.poster_size,
              'poster_crafts', coalesce(product.poster_crafts, '{}'),
              'release_date', product.release_date,
              'published_at', listing.published_at,
              'max_quantity', listing.max_quantity_per_customer
            ) as payload
          from public.claim_form_products listing
          join public.products product on product.id = listing.product_id
          left join public.works work on work.id = product.work_id
          where listing.form_id = form.id
        ) listed_product
      ),
      '[]'::jsonb
    ) as products
  from public.claim_forms form
  left join public.inventory_databases inventory
    on inventory.id = form.owner_id
  where form.public_token = p_token;
$$;

revoke all on function public.get_public_claim_form(uuid)
  from public, anon, authenticated;
grant execute on function public.get_public_claim_form(uuid)
  to anon, authenticated;

notify pgrst, 'reload schema';

commit;
