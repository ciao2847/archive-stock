begin;

-- The function returns a column named form_id, so PL/pgSQL also exposes
-- form_id as an output variable. Referencing form_id in an ON CONFLICT column
-- list is therefore ambiguous at runtime. Target the named primary-key
-- constraint instead.
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
  on conflict on constraint claim_form_products_pkey do update
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

notify pgrst, 'reload schema';
commit;
