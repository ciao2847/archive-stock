-- Existing published bundles retain their original fixed totals and evidence.
alter table public.bundle_claim_order_images
  add column product_name text,
  add column product_amount numeric(12,2),
  add constraint bundle_product_details_valid check (
    (product_name is null and product_amount is null) or
    (product_name is not null and char_length(btrim(product_name)) between 1 and 120
      and product_amount is not null and product_amount > 0
      and product_amount <= 9999999999.99)
  );

create or replace function private.set_bundle_claim_products(
  p_owner_id uuid, p_order_id bigint, p_products jsonb
) returns numeric
language plpgsql security definer set search_path = '' as $$
declare
  v_order public.bundle_claim_orders%rowtype;
  v_total numeric;
  v_count integer;
begin
  perform private.assert_bundle_inventory_access(p_owner_id);
  select * into v_order from public.bundle_claim_orders
    where id = p_order_id and owner_id = p_owner_id for update;
  if not found or v_order.status <> 'draft' then
    raise exception 'bundle claim draft not found';
  end if;
  if p_products is null or jsonb_typeof(p_products) <> 'array' then
    raise exception 'invalid bundle claim products';
  end if;
  select count(*) into v_count from public.bundle_claim_order_images where order_id = p_order_id;
  if v_count = 0 or v_count <> jsonb_array_length(p_products) or v_count > 10 then
    raise exception 'invalid bundle claim products';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_products) as item(id bigint, name text, amount numeric)
    left join public.bundle_claim_order_images image on image.id = item.id and image.order_id = p_order_id
    where image.id is null or char_length(btrim(coalesce(item.name,''))) not between 1 and 120
      or item.amount is null or item.amount <= 0 or item.amount > 9999999999.99
      or item.amount <> round(item.amount,2)
  ) or (select count(distinct item.id) from jsonb_to_recordset(p_products) as item(id bigint)) <> v_count then
    raise exception 'invalid bundle claim products';
  end if;
  select sum(item.amount) into v_total from jsonb_to_recordset(p_products) as item(amount numeric);
  if v_total > 9999999999.99 then raise exception 'invalid bundle claim total'; end if;
  update public.bundle_claim_order_images image
    set product_name = btrim(item.name), product_amount = item.amount
    from jsonb_to_recordset(p_products) as item(id bigint, name text, amount numeric)
    where image.id = item.id and image.order_id = p_order_id;
  update public.bundle_claim_orders set total_amount = v_total, updated_at = now() where id = p_order_id;
  return v_total;
end;
$$;
revoke all on function private.set_bundle_claim_products(uuid,bigint,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.set_bundle_claim_products(uuid,bigint,jsonb) to authenticated;
create or replace function public.set_bundle_claim_products(p_owner_id uuid,p_order_id bigint,p_products jsonb)
returns numeric language sql volatile security invoker set search_path = '' as $$
  select private.set_bundle_claim_products(p_owner_id,p_order_id,p_products)
$$;
revoke all on function public.set_bundle_claim_products(uuid,bigint,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.set_bundle_claim_products(uuid,bigint,jsonb) to authenticated;

create or replace function private.open_bundle_claim_order(p_owner_id uuid,p_order_id bigint)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_order public.bundle_claim_orders%rowtype;
  v_count integer;
  v_priced integer;
  v_total numeric;
begin
  perform private.assert_bundle_inventory_access(p_owner_id);
  select * into v_order from public.bundle_claim_orders
    where id = p_order_id and owner_id = p_owner_id for update;
  if not found or v_order.status <> 'draft' or (v_order.expires_at is not null and v_order.expires_at <= now()) then
    raise exception 'bundle claim cannot be opened';
  end if;
  select count(*),count(product_amount),sum(product_amount) into v_count,v_priced,v_total
    from public.bundle_claim_order_images where order_id = p_order_id;
  if v_count = 0 then raise exception 'bundle claim cannot be opened'; end if;
  -- All-null evidence supports older integrations. Itemized bundles must be complete.
  if v_priced > 0 and (v_priced <> v_count or v_total > 9999999999.99) then
    raise exception 'invalid bundle claim products';
  end if;
  update public.bundle_claim_orders set status = 'open',
    total_amount = case when v_priced > 0 then v_total else total_amount end,
    updated_at = now() where id = p_order_id;
  return true;
end;
$$;
create or replace function private.delete_bundle_claim_order_image(
  p_owner_id uuid,
  p_order_id bigint,
  p_image_id bigint
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_storage_path text;
  v_total numeric;
begin
  perform private.assert_bundle_inventory_access(p_owner_id);
  perform 1
  from public.bundle_claim_orders bundle_order
  where bundle_order.id = p_order_id
    and bundle_order.owner_id = p_owner_id
    and bundle_order.status = 'draft'
  for update;
  if not found then
    raise exception 'bundle claim draft not found';
  end if;

  delete from public.bundle_claim_order_images image
  where image.id = p_image_id
    and image.order_id = p_order_id
  returning image.storage_path into v_storage_path;
  if not found then
    raise exception 'bundle claim image not found';
  end if;
  select case when count(*) = count(product_amount) then sum(product_amount) end
    into v_total from public.bundle_claim_order_images where order_id = p_order_id;
  if v_total > 0 then
    update public.bundle_claim_orders set total_amount = v_total, updated_at = now() where id = p_order_id;
  end if;
  return v_storage_path;
end;
$$;


notify pgrst, 'reload schema';
