-- Re-enable itemized totals for drafts; preserve all-null legacy evidence and published records.
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
  -- All-null evidence supports previously published/direct-total integrations.
  -- Itemized drafts must be complete and sum under the locked order.
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
