begin;

-- Public claims use Taiwanese mobile numbers as the customer identifier.
-- Keep the stored and normalized forms identical so malformed values cannot
-- enter through a direct RPC call that bypasses the web form.
alter table public.claim_submissions
  drop constraint if exists claim_submissions_phone_length,
  drop constraint if exists claim_submissions_phone_normalized_length,
  add constraint claim_submissions_phone_format
    check (phone ~ '^09[0-9]{8}$'),
  add constraint claim_submissions_phone_normalized_format
    check (
      phone_normalized = phone
      and phone_normalized ~ '^09[0-9]{8}$'
    );

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

notify pgrst, 'reload schema';

commit;
