begin;

-- An inventory can publish one stable claim link per IP / series. The title is
-- the human-facing IP identifier, so keep it unique per owner while allowing
-- owner to maintain multiple independent forms.
alter table public.claim_forms
  drop constraint claim_forms_owner_id_key;

create unique index claim_forms_owner_title_unique_idx
  on public.claim_forms(owner_id, lower(btrim(title)));

create index claim_forms_owner_created_at_idx
  on public.claim_forms(owner_id, created_at desc, id desc);

create or replace function public.configure_claim_form(
  p_form_id bigint,
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
  v_constraint_name text;
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

  begin
    if p_form_id is null then
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
      returning claim_forms.id, claim_forms.public_token
        into v_form_id, v_public_token;
    else
      update public.claim_forms form
      set title = trim(p_title),
          description = nullif(trim(p_description), ''),
          is_open = coalesce(p_is_open, false),
          closes_at = p_closes_at,
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
    if v_constraint_name = 'claim_forms_owner_title_unique_idx' then
      raise exception 'claim form title already exists';
    end if;
    raise;
  end;

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
  bigint, uuid, text, text, boolean, timestamptz, jsonb
) from public, anon, authenticated;
grant execute on function public.configure_claim_form(
  bigint, uuid, text, text, boolean, timestamptz, jsonb
) to authenticated;

-- Keep the previous JSON payload signature working during a rolling frontend
-- deployment. It updates the matching title, or the owner's original form.
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
  v_existing_form_id bigint;
begin
  select form.id into v_existing_form_id
  from public.claim_forms form
  where form.owner_id = p_owner_id
  order by
    case when lower(btrim(form.title)) = lower(btrim(p_title)) then 0 else 1 end,
    form.created_at,
    form.id
  limit 1;

  return query
  select configured.form_id, configured.public_token
  from public.configure_claim_form(
    v_existing_form_id,
    p_owner_id,
    p_title,
    p_description,
    p_is_open,
    p_closes_at,
    p_products
  ) configured;
end;
$$;

revoke all on function public.configure_claim_form(
  uuid, text, text, boolean, timestamptz, jsonb
) from public, anon, authenticated;
grant execute on function public.configure_claim_form(
  uuid, text, text, boolean, timestamptz, jsonb
) to authenticated;

create or replace function public.get_claim_form_summary(p_form_id bigint)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_role public.user_role;
  v_owner_id uuid;
  v_result jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;
  select public.my_role() into v_role;
  if v_role is null or v_role not in ('admin', 'staff') then
    raise exception 'employee access required';
  end if;

  select form.owner_id into v_owner_id
  from public.claim_forms form
  where form.id = p_form_id;
  if not found then
    raise exception 'claim form not found';
  end if;
  if v_role <> 'admin'
    and v_owner_id <> (select private.current_inventory_owner_id()) then
    raise exception 'owner access required';
  end if;

  select jsonb_build_object(
    'submission_count', (
      select count(*)
      from public.claim_submissions submission
      where submission.form_id = p_form_id
    ),
    'customer_count', (
      select count(distinct (
        submission.phone_normalized,
        lower(submission.nickname)
      ))
      from public.claim_submissions submission
      where submission.form_id = p_form_id
    ),
    'item_count', (
      select coalesce(sum(item.quantity), 0)
      from public.claim_submission_items item
      join public.claim_submissions submission
        on submission.id = item.submission_id
      where submission.form_id = p_form_id
    ),
    'estimated_total', (
      select coalesce(sum(item.quantity * item.unit_price), 0)
      from public.claim_submission_items item
      join public.claim_submissions submission
        on submission.id = item.submission_id
      where submission.form_id = p_form_id
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
            on listing.form_id = p_form_id
           and listing.product_id = item.product_id
          where submission.form_id = p_form_id
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

revoke all on function public.get_claim_form_summary(bigint)
  from public, anon, authenticated;
grant execute on function public.get_claim_form_summary(bigint)
  to authenticated;

-- Preserve the owner-based summary RPC until all deployed frontends use a
-- concrete form ID. With several forms, it resolves to the latest one.
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
  where form.owner_id = p_owner_id
  order by form.updated_at desc, form.id desc
  limit 1;

  if v_form_id is null then
    return jsonb_build_object(
      'submission_count', 0,
      'customer_count', 0,
      'item_count', 0,
      'estimated_total', 0,
      'product_totals', '[]'::jsonb
    );
  end if;

  return public.get_claim_form_summary(v_form_id);
end;
$$;

revoke all on function public.get_claim_form_summary(uuid)
  from public, anon, authenticated;
grant execute on function public.get_claim_form_summary(uuid)
  to authenticated;

notify pgrst, 'reload schema';

commit;
