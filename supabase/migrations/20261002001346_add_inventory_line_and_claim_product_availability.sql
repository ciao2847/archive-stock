begin;

-- A single official LINE account is shared by every claim form in an
-- inventory. Keep the canonical leading @ so public links can be built
-- consistently without exposing any private credentials.
alter table public.inventory_databases
  add column official_line_id text null;

alter table public.inventory_databases
  add constraint inventory_databases_official_line_id_format
  check (
    official_line_id is null
    or official_line_id ~ '^@[A-Za-z0-9._-]{1,99}$'
  );

comment on column public.inventory_databases.official_line_id is
  'Public LINE Official Account ID used after a claim is submitted.';

-- Existing listings stay available. Managers can pause individual products
-- without removing their saved display name, price, or quantity limit.
alter table public.claim_form_products
  add column is_enabled boolean not null default true;

comment on column public.claim_form_products.is_enabled is
  'Whether this product currently accepts public claim submissions.';

-- Keep the privileged inventory write narrow and authorize against current
-- membership inside the definer function itself.
create or replace function private.update_inventory_official_line_id(
  p_inventory_id uuid,
  p_official_line_id text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_input text := nullif(btrim(coalesce(p_official_line_id, '')), '');
  v_official_line_id text;
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;
  if p_inventory_id is null then
    raise exception 'inventory database not found';
  end if;
  if (select public.my_role()) is distinct from 'admin'::public.user_role
    and not exists (
      select 1
      from public.inventory_database_members membership
      where membership.inventory_id = p_inventory_id
        and membership.user_id = v_user_id
    )
  then
    raise exception 'inventory access required';
  end if;

  v_official_line_id := case
    when v_input is null then null
    when left(v_input, 1) = '@' then v_input
    else '@' || v_input
  end;

  if v_official_line_id is not null
    and v_official_line_id !~ '^@[A-Za-z0-9._-]{1,99}$'
  then
    raise exception 'invalid official LINE ID';
  end if;

  update public.inventory_databases inventory
  set official_line_id = v_official_line_id,
      updated_at = now()
  where inventory.id = p_inventory_id;

  if not found then
    raise exception 'inventory database not found';
  end if;

  return p_inventory_id;
end;
$$;

revoke all on function private.update_inventory_official_line_id(uuid, text)
  from public, anon, authenticated;
grant execute on function private.update_inventory_official_line_id(uuid, text)
  to authenticated;

create or replace function public.update_inventory_official_line_id(
  p_inventory_id uuid,
  p_official_line_id text
)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.update_inventory_official_line_id(
    p_inventory_id,
    p_official_line_id
  )
$$;

revoke all on function public.update_inventory_official_line_id(uuid, text)
  from public, anon, authenticated;
grant execute on function public.update_inventory_official_line_id(uuid, text)
  to authenticated;

-- Persist each listing's enabled state while retaining inventory-wide claim
-- form appearance behavior from the previous function version.
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
  v_is_enabled boolean;
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

  for v_item in select value from jsonb_array_elements(v_products) loop
    if coalesce(jsonb_typeof(v_item), 'null') <> 'object'
      or coalesce(jsonb_typeof(v_item->'product_id'), 'null') <> 'string'
      or coalesce(jsonb_typeof(v_item->'name'), 'null') <> 'string'
      or coalesce(jsonb_typeof(v_item->'price'), 'null') <> 'number'
      or coalesce(jsonb_typeof(v_item->'max_quantity'), 'null') <> 'number'
      or coalesce(jsonb_typeof(v_item->'is_enabled'), 'null')
        not in ('boolean', 'null')
    then
      raise exception 'invalid claim form product';
    end if;

    begin
      v_product_id := (v_item->>'product_id')::uuid;
      v_display_name := trim(v_item->>'name');
      v_unit_price := (v_item->>'price')::numeric;
      v_max_quantity := (v_item->>'max_quantity')::integer;
      if jsonb_typeof(v_item->'is_enabled') = 'boolean' then
        v_is_enabled := (v_item->>'is_enabled')::boolean;
      else
        select coalesce(
          (
            select existing.is_enabled
            from public.claim_form_products existing
            where existing.form_id = p_form_id
              and existing.product_id = v_product_id
          ),
          true
        ) into v_is_enabled;
      end if;
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
      or v_is_enabled is null
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
    if v_constraint_name in (
      'claim_forms_owner_title_unique_idx',
      'claim_forms_owner_id_key'
    ) then
      raise exception 'claim form title already exists';
    end if;
    raise;
  end;

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

  delete from public.claim_form_products listing
  where listing.form_id = v_form_id
    and not (listing.product_id = any(v_product_ids));

  insert into public.claim_form_products(
    form_id,
    product_id,
    display_name,
    unit_price,
    max_quantity_per_customer,
    is_enabled,
    sort_order
  )
  select
    v_form_id,
    (requested.item->>'product_id')::uuid,
    trim(requested.item->>'name'),
    (requested.item->>'price')::numeric,
    (requested.item->>'max_quantity')::integer,
    coalesce(
      (requested.item->>'is_enabled')::boolean,
      (
        select existing.is_enabled
        from public.claim_form_products existing
        where existing.form_id = v_form_id
          and existing.product_id = (requested.item->>'product_id')::uuid
      ),
      true
    ),
    requested.position - 1
  from jsonb_array_elements(v_products) with ordinality
    as requested(item, position)
  on conflict on constraint claim_form_products_pkey do update
  set display_name = excluded.display_name,
      unit_price = excluded.unit_price,
      max_quantity_per_customer = excluded.max_quantity_per_customer,
      is_enabled = excluded.is_enabled,
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

-- Public form payloads expose the inventory's public contact ID and only
-- listings that can currently accept claims.
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
  official_line_id text,
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
    inventory.official_line_id,
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
            and listing.is_enabled
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

-- Enforce availability inside the write transaction as well. A caller cannot
-- submit a paused product by bypassing the public page and posting its UUID.
create or replace function public.submit_public_claim(
  p_token uuid,
  p_nickname text,
  p_phone text,
  p_notes text,
  p_request_id uuid,
  p_items jsonb
)
returns table(confirmation_code text, submitted_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_form_id bigint;
  v_is_open boolean;
  v_closes_at timestamptz;
  v_nickname text := trim(p_nickname);
  v_phone text := p_phone;
  v_phone_normalized text := p_phone;
  v_submission_id bigint;
  v_confirmation_code text;
  v_submitted_at timestamptz;
  v_item jsonb;
  v_product_id uuid;
  v_quantity integer;
  v_seen_product_ids uuid[] := array[]::uuid[];
  v_max_quantity integer;
begin
  if p_token is null or p_request_id is null then
    raise exception 'invalid claim request';
  end if;

  select form.id, form.is_open, form.closes_at
    into v_form_id, v_is_open, v_closes_at
  from public.claim_forms form
  where form.public_token = p_token
  for share;

  if not found then
    raise exception 'claim form not found';
  end if;

  select submission.confirmation_code, submission.created_at
    into v_confirmation_code, v_submitted_at
  from public.claim_submissions submission
  where submission.form_id = v_form_id
    and submission.request_id = p_request_id;
  if found then
    return query select v_confirmation_code, v_submitted_at;
    return;
  end if;

  if not v_is_open or (v_closes_at is not null and v_closes_at <= now()) then
    raise exception 'claim form is closed';
  end if;
  if v_nickname is null or char_length(v_nickname) not between 1 and 100 then
    raise exception 'invalid customer nickname';
  end if;
  if v_phone is null or v_phone !~ '^09[0-9]{8}$' then
    raise exception 'invalid customer phone';
  end if;
  if char_length(coalesce(p_notes, '')) > 1000 then
    raise exception 'claim notes are too long';
  end if;
  if p_items is null
    or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) < 1
    or jsonb_array_length(p_items) > 100 then
    raise exception 'claim items must contain between 1 and 100 entries';
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    begin
      v_product_id := (v_item->>'product_id')::uuid;
      v_quantity := (v_item->>'quantity')::integer;
    exception when others then
      raise exception 'invalid claim item';
    end;

    if v_product_id is null
      or v_quantity is null
      or v_quantity < 1
      or v_quantity > 99
      or v_product_id = any(v_seen_product_ids) then
      raise exception 'invalid claim item';
    end if;

    select listing.max_quantity_per_customer
      into v_max_quantity
    from public.claim_form_products listing
    where listing.form_id = v_form_id
      and listing.product_id = v_product_id
      and listing.is_enabled
    for share;
    if not found or v_quantity > v_max_quantity then
      raise exception 'claim product is not available';
    end if;

    v_seen_product_ids := array_append(v_seen_product_ids, v_product_id);
  end loop;

  begin
    insert into public.claim_submissions(
      form_id,
      request_id,
      nickname,
      phone,
      phone_normalized,
      notes
    )
    values (
      v_form_id,
      p_request_id,
      v_nickname,
      v_phone,
      v_phone_normalized,
      nullif(trim(p_notes), '')
    )
    returning id, claim_submissions.confirmation_code, created_at
      into v_submission_id, v_confirmation_code, v_submitted_at;
  exception when unique_violation then
    select submission.confirmation_code, submission.created_at
      into v_confirmation_code, v_submitted_at
    from public.claim_submissions submission
    where submission.form_id = v_form_id
      and submission.request_id = p_request_id;
    if found then
      return query select v_confirmation_code, v_submitted_at;
      return;
    end if;
    raise exception 'claim request conflict';
  end;

  insert into public.claim_submission_items(
    submission_id,
    product_id,
    product_sku,
    product_name,
    quantity,
    unit_price
  )
  select
    v_submission_id,
    product.id,
    product.sku,
    listing.display_name,
    requested.quantity,
    listing.unit_price
  from jsonb_to_recordset(p_items)
    as requested(product_id uuid, quantity integer)
  join public.claim_form_products listing
    on listing.form_id = v_form_id
   and listing.product_id = requested.product_id
   and listing.is_enabled
  join public.products product on product.id = requested.product_id;

  return query select v_confirmation_code, v_submitted_at;
end;
$$;

revoke all on function public.submit_public_claim(
  uuid, text, text, text, uuid, jsonb
) from public, anon, authenticated;
grant execute on function public.submit_public_claim(
  uuid, text, text, text, uuid, jsonb
) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
