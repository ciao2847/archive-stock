begin;

-- A claim form is an intentionally separate preorder workflow. Submissions
-- collect demand and never reserve or deduct physical inventory.
-- Upcoming products may therefore be created with zero stock and no location;
-- QR labels are generated only after physical stock is added.
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
    and p_owner_id <> (select private.current_inventory_owner_id())
  ) then
    raise exception 'owner access required';
  end if;
  if nullif(trim(p_name), '') is null
    or nullif(trim(p_work), '') is null then
    raise exception 'product and work names are required';
  end if;
  if p_stock is null or p_stock < 0 or p_stock > 1000
    or p_price is null or p_price < 0
    or p_cost is null or p_cost < 0 then
    raise exception 'invalid product amount';
  end if;
  if p_stock > 0 and nullif(trim(p_location), '') is null then
    raise exception 'product location is required for physical stock';
  end if;
  if nullif(trim(p_location), '') is not null
    and upper(trim(p_location)) !~ '^[A-Z]-[0-9]{2}-[0-9]{2}$' then
    raise exception 'invalid product location';
  end if;

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

revoke all on function public.create_inventory_product(
  text, text, text, text, text, text, integer, numeric, numeric,
  text[], text, text, text[], text, uuid, text
) from public, anon;
grant execute on function public.create_inventory_product(
  text, text, text, text, text, text, integer, numeric, numeric,
  text[], text, text, text[], text, uuid, text
) to authenticated;

create table public.claim_forms (
  id bigint generated always as identity primary key,
  owner_id uuid not null
    references public.inventory_databases(id) on delete cascade,
  public_token uuid not null default gen_random_uuid(),
  title text not null
    constraint claim_forms_title_length
    check (char_length(trim(title)) between 1 and 120),
  description text
    constraint claim_forms_description_length
    check (description is null or char_length(description) <= 2000),
  is_open boolean not null default false,
  closes_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint claim_forms_owner_id_key unique (owner_id),
  constraint claim_forms_public_token_key unique (public_token)
);

create index claim_forms_created_by_idx
  on public.claim_forms(created_by);

create table public.claim_form_products (
  form_id bigint not null
    references public.claim_forms(id) on delete cascade,
  product_id uuid not null
    references public.products(id) on delete cascade,
  sort_order integer not null default 0
    constraint claim_form_products_sort_order_check
    check (sort_order >= 0),
  max_quantity_per_customer integer not null default 20
    constraint claim_form_products_max_quantity_check
    check (max_quantity_per_customer between 1 and 99),
  published_at timestamptz not null default now(),
  primary key (form_id, product_id)
);

create index claim_form_products_product_id_idx
  on public.claim_form_products(product_id);

create table public.claim_submissions (
  id bigint generated always as identity primary key,
  form_id bigint not null
    references public.claim_forms(id) on delete cascade,
  request_id uuid not null,
  confirmation_code text not null default (
    'HD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
  ),
  nickname text not null
    constraint claim_submissions_nickname_length
    check (char_length(trim(nickname)) between 1 and 100),
  phone text not null
    constraint claim_submissions_phone_length
    check (char_length(trim(phone)) between 8 and 30),
  phone_normalized text not null
    constraint claim_submissions_phone_normalized_length
    check (char_length(phone_normalized) between 8 and 15),
  notes text
    constraint claim_submissions_notes_length
    check (notes is null or char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  constraint claim_submissions_confirmation_code_key
    unique (confirmation_code),
  constraint claim_submissions_form_request_key
    unique (form_id, request_id)
);

create index claim_submissions_form_created_at_idx
  on public.claim_submissions(form_id, created_at desc);

-- request_id makes retries from the same browser idempotent even when a
-- response is lost. The same customer may submit again when new products are
-- published later in an ongoing claim form.
create index claim_submissions_customer_idx
  on public.claim_submissions(form_id, phone_normalized, lower(nickname));

create table public.claim_submission_items (
  id bigint generated always as identity primary key,
  submission_id bigint not null
    references public.claim_submissions(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_sku text not null,
  product_name text not null,
  quantity integer not null
    constraint claim_submission_items_quantity_check
    check (quantity between 1 and 99),
  unit_price numeric(12, 2) not null
    constraint claim_submission_items_unit_price_check
    check (unit_price >= 0),
  created_at timestamptz not null default now(),
  constraint claim_submission_items_submission_product_key
    unique (submission_id, product_id)
);

create index claim_submission_items_product_id_idx
  on public.claim_submission_items(product_id);

alter table public.claim_forms enable row level security;
alter table public.claim_form_products enable row level security;
alter table public.claim_submissions enable row level security;
alter table public.claim_submission_items enable row level security;

-- Explicit grants keep every anonymous operation behind the two carefully
-- scoped public RPCs below. Authenticated users still need to pass RLS.
revoke all on table public.claim_forms from public, anon, authenticated;
revoke all on table public.claim_form_products from public, anon, authenticated;
revoke all on table public.claim_submissions from public, anon, authenticated;
revoke all on table public.claim_submission_items from public, anon, authenticated;

grant select, insert, update on table public.claim_forms to authenticated;
grant select, insert, update, delete on table public.claim_form_products
  to authenticated;
grant select on table public.claim_submissions to authenticated;
grant select on table public.claim_submission_items to authenticated;

grant usage, select on sequence public.claim_forms_id_seq to authenticated;

create policy "inventory members read claim forms"
on public.claim_forms for select to authenticated
using (
  owner_id = (select private.current_inventory_owner_id())
  or (select public.my_role()) = 'admin'
);

create policy "inventory members create claim forms"
on public.claim_forms for insert to authenticated
with check (
  owner_id = (select private.current_inventory_owner_id())
  or (select public.my_role()) = 'admin'
);

create policy "inventory members update claim forms"
on public.claim_forms for update to authenticated
using (
  owner_id = (select private.current_inventory_owner_id())
  or (select public.my_role()) = 'admin'
)
with check (
  owner_id = (select private.current_inventory_owner_id())
  or (select public.my_role()) = 'admin'
);

create policy "inventory members read claim form products"
on public.claim_form_products for select to authenticated
using (
  exists (
    select 1
    from public.claim_forms form
    where form.id = claim_form_products.form_id
      and (
        form.owner_id = (select private.current_inventory_owner_id())
        or (select public.my_role()) = 'admin'
      )
  )
);

create policy "inventory members add claim form products"
on public.claim_form_products for insert to authenticated
with check (
  exists (
    select 1
    from public.claim_forms form
    join public.products product
      on product.id = claim_form_products.product_id
    where form.id = claim_form_products.form_id
      and product.owner_id = form.owner_id
      and (
        form.owner_id = (select private.current_inventory_owner_id())
        or (select public.my_role()) = 'admin'
      )
  )
);

create policy "inventory members update claim form products"
on public.claim_form_products for update to authenticated
using (
  exists (
    select 1
    from public.claim_forms form
    where form.id = claim_form_products.form_id
      and (
        form.owner_id = (select private.current_inventory_owner_id())
        or (select public.my_role()) = 'admin'
      )
  )
)
with check (
  exists (
    select 1
    from public.claim_forms form
    join public.products product
      on product.id = claim_form_products.product_id
    where form.id = claim_form_products.form_id
      and product.owner_id = form.owner_id
      and (
        form.owner_id = (select private.current_inventory_owner_id())
        or (select public.my_role()) = 'admin'
      )
  )
);

create policy "inventory members remove claim form products"
on public.claim_form_products for delete to authenticated
using (
  exists (
    select 1
    from public.claim_forms form
    where form.id = claim_form_products.form_id
      and (
        form.owner_id = (select private.current_inventory_owner_id())
        or (select public.my_role()) = 'admin'
      )
  )
);

create policy "inventory members read claim submissions"
on public.claim_submissions for select to authenticated
using (
  exists (
    select 1
    from public.claim_forms form
    where form.id = claim_submissions.form_id
      and (
        form.owner_id = (select private.current_inventory_owner_id())
        or (select public.my_role()) = 'admin'
      )
  )
);

create policy "inventory members read claim submission items"
on public.claim_submission_items for select to authenticated
using (
  exists (
    select 1
    from public.claim_submissions submission
    join public.claim_forms form on form.id = submission.form_id
    where submission.id = claim_submission_items.submission_id
      and (
        form.owner_id = (select private.current_inventory_owner_id())
        or (select public.my_role()) = 'admin'
      )
  )
);

create or replace function public.configure_claim_form(
  p_owner_id uuid,
  p_title text,
  p_description text,
  p_is_open boolean,
  p_closes_at timestamptz,
  p_product_ids uuid[]
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
  v_product_ids uuid[] := coalesce(p_product_ids, array[]::uuid[]);
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;

  select public.my_role() into v_role;
  if v_role is null or v_role not in ('admin', 'staff') then
    raise exception 'employee access required';
  end if;
  if v_role <> 'admin'
    and p_owner_id <> (select private.current_inventory_owner_id()) then
    raise exception 'owner access required';
  end if;
  if nullif(trim(p_title), '') is null
    or char_length(trim(p_title)) > 120 then
    raise exception 'invalid claim form title';
  end if;
  if char_length(coalesce(p_description, '')) > 2000 then
    raise exception 'claim form description is too long';
  end if;
  if cardinality(v_product_ids) > 200 then
    raise exception 'too many claim form products';
  end if;
  if (
    select count(*) <> count(distinct requested_id)
    from unnest(v_product_ids) requested_id
  ) then
    raise exception 'duplicate claim form products are not allowed';
  end if;
  if exists (
    select 1
    from unnest(v_product_ids) requested_id
    where not exists (
      select 1
      from public.products product
      where product.id = requested_id
        and product.owner_id = p_owner_id
    )
  ) then
    raise exception 'claim form product is not available';
  end if;

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

  insert into public.claim_form_products(form_id, product_id, sort_order)
  select v_form_id, requested.product_id, requested.position - 1
  from unnest(v_product_ids) with ordinality
    as requested(product_id, position)
  join public.products product
    on product.id = requested.product_id
   and product.owner_id = p_owner_id
  on conflict (form_id, product_id) do update
  set sort_order = excluded.sort_order;

  return query select v_form_id, v_public_token;
end;
$$;

revoke all on function public.configure_claim_form(
  uuid, text, text, boolean, timestamptz, uuid[]
) from public, anon;
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
            product.name as product_name,
            jsonb_build_object(
              'id', product.id,
              'sku', product.sku,
              'name', product.name,
              'work', work.title_zh,
              'category', product.category,
              'country', product.country,
              'source', product.source,
              'description', product.description,
              'price', coalesce(product.price, 0),
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

revoke all on function public.get_public_claim_form(uuid) from public;
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
    product.name,
    requested.quantity,
    coalesce(product.price, 0)
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
) from public;
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
  if v_role <> 'admin'
    and p_owner_id <> (select private.current_inventory_owner_id()) then
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
            coalesce(product.name, item.product_name) as product_name,
            sum(item.quantity)::integer as quantity,
            count(distinct (
              submission.phone_normalized,
              lower(submission.nickname)
            ))::integer as customer_count,
            jsonb_build_object(
              'product_id', item.product_id,
              'sku', coalesce(product.sku, item.product_sku),
              'name', coalesce(product.name, item.product_name),
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
          where submission.form_id = v_form_id
          group by
            item.product_id,
            coalesce(product.sku, item.product_sku),
            coalesce(product.name, item.product_name)
        ) product_total
      ),
      '[]'::jsonb
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_claim_form_summary(uuid)
  from public, anon;
grant execute on function public.get_claim_form_summary(uuid)
  to authenticated;

-- Public claim pages intentionally display product images. The same bucket is
-- already used by the public QR recommendation page, and object paths live in
-- random UUID directories.
update storage.buckets
set public = true
where id = 'product-images';

notify pgrst, 'reload schema';
commit;
