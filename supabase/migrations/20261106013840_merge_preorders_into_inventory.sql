begin;

alter table public.products
  add column merged_into_product_id uuid references public.products(id) on delete restrict,
  add column merged_at timestamptz,
  add column merged_by uuid references public.profiles(id) on delete restrict,
  add constraint products_merge_metadata check (
    (merged_into_product_id is null and merged_at is null and merged_by is null)
    or (merged_into_product_id is not null and merged_into_product_id <> id and merged_at is not null and merged_by is not null)
  );
create index products_merged_into_idx on public.products(merged_into_product_id) where merged_into_product_id is not null;
create index products_merged_by_idx on public.products(merged_by) where merged_by is not null;

-- A retired identity is immutable, including to old inventory/receiving RPCs.
create function private.guard_merged_product() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op <> 'INSERT' and old.merged_into_product_id is not null then
    raise exception 'product already merged';
  end if;
  if tg_op <> 'DELETE' and new.merged_into_product_id is not null
    and current_user in ('authenticated','anon') then
    raise exception 'use product merge operation';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end; $$;
revoke all on function private.guard_merged_product() from public, anon, authenticated;
create trigger guard_merged_product before insert or update or delete on public.products
for each row execute function private.guard_merged_product();

-- Key-share prevents a stale write racing retirement. Existing RLS/RPC ownership
-- checks still apply; this guard only rejects reuse of a retired identity.
create function private.guard_merged_product_reference() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare v_product uuid; v_merged uuid;
begin
  if tg_table_name = 'bundle_claim_order_images' then v_product := new.received_product_id;
  else v_product := new.product_id; end if;
  if v_product is not null then
    select merged_into_product_id into v_merged from public.products where id = v_product for key share;
    if v_merged is not null then raise exception 'product already merged'; end if;
  end if;
  return new;
end; $$;
revoke all on function private.guard_merged_product_reference() from public, anon, authenticated;
create trigger guard_merged_product_reference before insert or update of product_id on public.claim_form_products
for each row execute function private.guard_merged_product_reference();
create trigger guard_merged_product_reference before insert or update of product_id on public.claim_submission_items
for each row execute function private.guard_merged_product_reference();
create trigger guard_merged_product_reference before insert or update of product_id on public.packing_package_items
for each row execute function private.guard_merged_product_reference();
create trigger guard_merged_product_reference before insert or update of product_id on public.packing_scans
for each row execute function private.guard_merged_product_reference();
create trigger guard_merged_product_reference before insert or update of product_id on public.order_items
for each row execute function private.guard_merged_product_reference();
create trigger guard_merged_product_reference before insert or update of product_id on public.bundle_fulfillment_items
for each row execute function private.guard_merged_product_reference();
create trigger guard_merged_product_reference before insert or update of product_id on public.product_location_stocks
for each row execute function private.guard_merged_product_reference();
create trigger guard_merged_product_reference before insert or update of product_id on public.product_qr_labels
for each row execute function private.guard_merged_product_reference();
create trigger guard_merged_product_reference before insert or update of product_id on public.location_movements
for each row execute function private.guard_merged_product_reference();
create trigger guard_merged_product_reference before insert or update of received_product_id on public.bundle_claim_order_images
for each row execute function private.guard_merged_product_reference();

-- Source ledgers expose reads only to staff, so their authorized mutation lives
-- privately with a public invoker wrapper. Never trust caller-supplied counts.
create function private.merge_preorder_product(
  p_owner_id uuid, p_source_id uuid, p_target_id uuid,
  p_apply boolean default false, p_expected_token text default null
) returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
declare
  v_source public.products; v_target public.products;
  v_forms jsonb; v_orders jsonb; v_conflicts jsonb; v_preview jsonb; v_token text;
  v_claims bigint; v_fulfillment bigint; v_items jsonb; v_bundles jsonb; v_listings jsonb;
begin
  if (select auth.uid()) is null or coalesce((select public.my_role())::text,'') not in ('admin','staff') then
    raise exception 'employee access required';
  end if;
  if p_owner_id is null or (p_owner_id is distinct from (select private.current_inventory_owner_id()) and (select public.my_role()) <> 'admin') then
    raise exception 'owner access required';
  end if;
  if p_source_id is null or p_target_id is null or p_source_id = p_target_id or p_apply is null then
    raise exception 'invalid merge pair';
  end if;
  if p_apply then
    -- Rare administrative operation: briefly serialize ledger writes, leaving
    -- reads available. Locks cover new references as well as existing rows.
    lock table public.claim_forms, public.claim_submissions, public.orders,
      public.claim_form_products, public.claim_submission_items, public.order_items,
      public.bundle_fulfillment_items, public.packing_package_items, public.packing_scans,
      public.product_qr_labels, public.product_location_stocks, public.location_movements,
      public.bundle_claim_order_images in share row exclusive mode;
    perform 1 from public.products where id in (p_source_id,p_target_id) order by id for update;
  end if;
  select * into v_source from public.products where id = p_source_id and owner_id = p_owner_id;
  if not found then raise exception 'merge product not found'; end if;
  select * into v_target from public.products where id = p_target_id and owner_id = p_owner_id;
  if not found then raise exception 'merge product not found'; end if;
  if v_source.merged_into_product_id is not null or v_target.merged_into_product_id is not null then
    raise exception 'product already merged';
  end if;
  if v_source.stock <> 0 or v_source.location_id is not null
    or exists(select 1 from public.product_qr_labels where product_id = p_source_id)
    or exists(select 1 from public.product_location_stocks where product_id = p_source_id)
    or exists(select 1 from public.location_movements where product_id = p_source_id)
    or exists(select 1 from public.bundle_claim_order_images where received_product_id = p_source_id)
    or (v_source.preorder_item_name is null
      and not exists(select 1 from public.claim_form_products where product_id = p_source_id)
      and not exists(select 1 from public.claim_submission_items where product_id = p_source_id)) then
    raise exception 'source is not unreceived preorder';
  end if;
  if v_target.stock = 0 and v_target.location_id is null
    and not exists(select 1 from public.product_qr_labels where product_id = p_target_id)
    and not exists(select 1 from public.location_movements where product_id = p_target_id)
    and not exists(select 1 from public.bundle_claim_order_images where received_product_id = p_target_id) then
    raise exception 'target is not received product';
  end if;

  -- Fail closed on corrupt historical cross-inventory references as well.
  if exists(select 1 from public.claim_form_products l join public.claim_forms f on f.id=l.form_id
      where l.product_id=p_source_id and f.owner_id<>p_owner_id)
    or exists(select 1 from public.claim_submission_items i join public.claim_submissions s on s.id=i.submission_id
      join public.claim_forms f on f.id=s.form_id where i.product_id=p_source_id and f.owner_id<>p_owner_id)
    or exists(select 1 from public.order_items i join public.orders o on o.id=i.order_id
      where i.product_id=p_source_id and o.owner_id<>p_owner_id)
    or exists(select 1 from public.bundle_fulfillment_items i join public.bundle_claim_orders b on b.id=i.bundle_order_id
      where i.product_id=p_source_id and b.owner_id<>p_owner_id) then
    raise exception 'merge ownership conflict';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',f.id,'title',f.title,'targetAlreadyListed',t.product_id is not null,
    'listing',jsonb_build_object('name',coalesce(t.display_name,s.display_name),
      'price',coalesce(t.unit_price,s.unit_price),'maxQuantity',coalesce(t.max_quantity_per_customer,s.max_quantity_per_customer),
      'isEnabled',coalesce(t.is_enabled,s.is_enabled))) order by f.id),'[]') into v_forms
  from public.claim_form_products s join public.claim_forms f on f.id=s.form_id
  left join public.claim_form_products t on t.form_id=s.form_id and t.product_id=p_target_id
  where s.product_id=p_source_id;
  select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]'), count(distinct i.submission_id)
    into v_items,v_claims from public.claim_submission_items i where i.product_id in (p_source_id,p_target_id);
  -- Count only affected source submissions; target rows above are fingerprinted
  -- so adding a conflicting line after preview invalidates confirmation.
  select count(distinct submission_id) into v_claims from public.claim_submission_items where product_id=p_source_id;
  select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]'), count(distinct i.order_id) filter(where i.product_id=p_source_id)
    into v_orders,v_fulfillment from public.order_items i where i.product_id in (p_source_id,p_target_id);
  select coalesce(jsonb_agg(to_jsonb(i) order by i.bundle_order_id,i.product_id),'[]') into v_bundles
    from public.bundle_fulfillment_items i where i.product_id in (p_source_id,p_target_id);
  select coalesce(jsonb_agg(to_jsonb(l) order by l.form_id,l.product_id),'[]') into v_listings
    from public.claim_form_products l where l.product_id in (p_source_id,p_target_id);

  select coalesce(jsonb_agg(jsonb_build_object('kind',c.kind,'code',c.code) order by c.kind,c.code),'[]') into v_conflicts
  from (
    select 'claim'::text as kind,s.confirmation_code as code from public.claim_submissions s
      where exists(select 1 from public.claim_submission_items i where i.submission_id=s.id and i.product_id=p_source_id)
        and exists(select 1 from public.claim_submission_items i where i.submission_id=s.id and i.product_id=p_target_id)
    union all
    select 'order',o.order_no from public.orders o
      where exists(select 1 from public.order_items i where i.order_id=o.id and i.product_id=p_source_id)
        and exists(select 1 from public.order_items i where i.order_id=o.id and i.product_id=p_target_id)
    union all
    select 'bundle',b.confirmation_code from public.bundle_claim_orders b
      where exists(select 1 from public.bundle_fulfillment_items i where i.bundle_order_id=b.id and i.product_id=p_source_id)
        and exists(select 1 from public.bundle_fulfillment_items i where i.bundle_order_id=b.id and i.product_id=p_target_id)
  ) c;
  v_preview := jsonb_build_object(
    'source',jsonb_build_object('id',v_source.id,'sku',v_source.sku,'name',v_source.name,'stock',v_source.stock),
    'target',jsonb_build_object('id',v_target.id,'sku',v_target.sku,'name',v_target.name,'stock',v_target.stock),
    'forms',v_forms,'submissionCount',v_claims,'fulfillmentCount',v_fulfillment,'conflicts',v_conflicts,'merged',false);
  v_token := md5(jsonb_build_array(to_jsonb(v_source),to_jsonb(v_target),v_preview,v_items,v_orders,v_bundles,v_listings)::text);
  v_preview := v_preview || jsonb_build_object('token',v_token);
  if not p_apply then return v_preview; end if;
  if p_expected_token is distinct from v_token then raise exception 'merge preview changed'; end if;
  if jsonb_array_length(v_conflicts) > 0 then raise exception 'merge order conflict'; end if;

  -- Update the projection first: the source trigger then sees equivalent items
  -- even for scanned/packed/settled orders and preserves their progress.
  update public.order_items set product_id=p_target_id where product_id=p_source_id;
  update public.packing_package_items set product_id=p_target_id where product_id=p_source_id;
  update public.packing_scans set product_id=p_target_id where product_id=p_source_id;
  update public.bundle_fulfillment_items set product_id=p_target_id where product_id=p_source_id;
  update public.claim_submission_items set product_id=p_target_id where product_id=p_source_id;
  delete from public.claim_form_products s where s.product_id=p_source_id
    and exists(select 1 from public.claim_form_products t where t.form_id=s.form_id and t.product_id=p_target_id);
  update public.claim_form_products set product_id=p_target_id where product_id=p_source_id;
  update public.products set merged_into_product_id=p_target_id, merged_at=now(), merged_by=(select auth.uid())
    where id=p_source_id;
  return v_preview || jsonb_build_object('merged',true);
end; $$;
revoke all on function private.merge_preorder_product(uuid,uuid,uuid,boolean,text) from public, anon, authenticated;
grant execute on function private.merge_preorder_product(uuid,uuid,uuid,boolean,text) to authenticated;
create function public.merge_preorder_product(
  p_owner_id uuid, p_source_id uuid, p_target_id uuid,
  p_apply boolean default false, p_expected_token text default null
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.merge_preorder_product(p_owner_id,p_source_id,p_target_id,p_apply,p_expected_token);
$$;
revoke all on function public.merge_preorder_product(uuid,uuid,uuid,boolean,text) from public, anon;
grant execute on function public.merge_preorder_product(uuid,uuid,uuid,boolean,text) to authenticated;
notify pgrst, 'reload schema';
commit;
