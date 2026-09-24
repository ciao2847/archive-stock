begin;

-- Claim listings keep their own customer-facing name, price, and quantity
-- limit. Editing a listing must not mutate the inventory product master.
alter table public.claim_form_products
  add column display_name text,
  add column unit_price numeric(12, 2);

update public.claim_form_products listing
set display_name = product.name,
    unit_price = product.price
from public.products product
where product.id = listing.product_id;

alter table public.claim_form_products
  alter column display_name set not null,
  alter column unit_price set not null,
  add constraint claim_form_products_display_name_length
    check (char_length(trim(display_name)) between 1 and 300),
  add constraint claim_form_products_unit_price_check
    check (unit_price between 0 and 9999999999.99);

create or replace function public.configure_claim_form(
  p_owner_id uuid,
  p_title text,
  p_description text,
  p_is_open boolean,
  p_closes_at timestamptz,
  p_products jsonb
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

  insert into public.claim_forms(
    owner_id,
    title,
    description,
    is_open,
    closes_at,
    created_by
  )
  values (
    p_owner_id,
    trim(p_title),
    nullif(trim(p_description), ''),
    coalesce(p_is_open, false),
    p_closes_at,
    (select auth.uid())
  )
  on conflict (owner_id) do update
  set title = excluded.title,
      description = excluded.description,
      is_open = excluded.is_open,
      closes_at = excluded.closes_at,
      updated_at = now()
  returning id, claim_forms.public_token
    into v_form_id, v_public_token;

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
  on conflict (form_id, product_id) do update
  set display_name = excluded.display_name,
      unit_price = excluded.unit_price,
      max_quantity_per_customer = excluded.max_quantity_per_customer,
      sort_order = excluded.sort_order;

  return query select v_form_id, v_public_token;
end;
$$;

revoke all on function public.configure_claim_form(
  uuid, text, text, boolean, timestamptz, jsonb
) from public, anon, authenticated;
grant execute on function public.configure_claim_form(
  uuid, text, text, boolean, timestamptz, jsonb
) to authenticated;

-- Keep the previous UUID-array signature working during a rolling frontend
-- deployment. It copies the inventory defaults into the new listing fields.
create or replace function public.configure_claim_form(
  p_owner_id uuid,
  p_title text,
  p_description text,
  p_is_open boolean,
  p_closes_at timestamptz,
  p_product_ids uuid[]
)
returns table(form_id bigint, public_token uuid)
language sql
security invoker
set search_path = ''
as $$
  select configured.form_id, configured.public_token
  from public.configure_claim_form(
    p_owner_id,
    p_title,
    p_description,
    p_is_open,
    p_closes_at,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'product_id', requested.product_id,
            'name', product.name,
            'price', product.price,
            'max_quantity', 20
          )
          order by requested.position
        )
        from unnest(coalesce(p_product_ids, array[]::uuid[]))
          with ordinality as requested(product_id, position)
        left join public.products product
          on product.id = requested.product_id
      ),
      '[]'::jsonb
    )
  ) configured;
$$;

revoke all on function public.configure_claim_form(
  uuid, text, text, boolean, timestamptz, uuid[]
) from public, anon, authenticated;
grant execute on function public.configure_claim_form(
  uuid, text, text, boolean, timestamptz, uuid[]
) to authenticated;

create or replace function public.get_public_claim_form(p_token uuid)
returns table(
  store_name text,
  title text,
  description text,
  is_open boolean,
  closes_at timestamptz,
  products jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(inventory.name, '喊單表單') as store_name,
    form.title,
    form.description,
    form.is_open and (form.closes_at is null or form.closes_at > now())
      as is_open,
    form.closes_at,
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
  v_phone text := trim(p_phone);
  v_phone_normalized text := regexp_replace(trim(p_phone), '[^0-9]', '', 'g');
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
  if v_phone is null
    or char_length(v_phone) not between 8 and 30
    or v_phone !~ '^[-0-9+(). ]+$'
    or char_length(v_phone_normalized) not between 8 and 15 then
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

create or replace function public.get_claim_form_summary(p_owner_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_role public.user_role;
  v_form_id bigint;
  v_result jsonb;
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

  select form.id into v_form_id
  from public.claim_forms form
  where form.owner_id = p_owner_id;

  if v_form_id is null then
    return jsonb_build_object(
      'submission_count', 0,
      'customer_count', 0,
      'item_count', 0,
      'estimated_total', 0,
      'product_totals', '[]'::jsonb
    );
  end if;

  select jsonb_build_object(
    'submission_count', (
      select count(*)
      from public.claim_submissions submission
      where submission.form_id = v_form_id
    ),
    'customer_count', (
      select count(distinct (
        submission.phone_normalized,
        lower(submission.nickname)
      ))
      from public.claim_submissions submission
      where submission.form_id = v_form_id
    ),
    'item_count', (
      select coalesce(sum(item.quantity), 0)
      from public.claim_submission_items item
      join public.claim_submissions submission
        on submission.id = item.submission_id
      where submission.form_id = v_form_id
    ),
    'estimated_total', (
      select coalesce(sum(item.quantity * item.unit_price), 0)
      from public.claim_submission_items item
      join public.claim_submissions submission
        on submission.id = item.submission_id
      where submission.form_id = v_form_id
    ),
    'product_totals', coalesce(
      (
        select jsonb_agg(product_total.payload order by
          product_total.quantity desc,
          product_total.product_name
        )
        from (
          select
            item.product_id,
            coalesce(product.sku, item.product_sku) as product_sku,
            coalesce(listing.display_name, item.product_name)
              as product_name,
            sum(item.quantity)::integer as quantity,
            count(distinct (
              submission.phone_normalized,
              lower(submission.nickname)
            ))::integer as customer_count,
            jsonb_build_object(
              'product_id', item.product_id,
              'sku', coalesce(product.sku, item.product_sku),
              'name', coalesce(listing.display_name, item.product_name),
              'quantity', sum(item.quantity),
              'customer_count', count(distinct (
                submission.phone_normalized,
                lower(submission.nickname)
              ))
            ) as payload
          from public.claim_submission_items item
          join public.claim_submissions submission
            on submission.id = item.submission_id
          left join public.products product on product.id = item.product_id
          left join public.claim_form_products listing
            on listing.form_id = v_form_id
           and listing.product_id = item.product_id
          where submission.form_id = v_form_id
          group by
            item.product_id,
            coalesce(product.sku, item.product_sku),
            coalesce(listing.display_name, item.product_name)
        ) product_total
      ),
      '[]'::jsonb
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_claim_form_summary(uuid)
  from public, anon, authenticated;
grant execute on function public.get_claim_form_summary(uuid)
  to authenticated;

notify pgrst, 'reload schema';
commit;
