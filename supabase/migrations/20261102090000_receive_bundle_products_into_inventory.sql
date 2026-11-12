begin;

-- A durable per-image link makes retries and check reversal safe. It also
-- prevents removal of an inventory product that still belongs to a bundle order.
alter table public.bundle_claim_order_images
  add column received_product_id uuid references public.products(id) on delete restrict;
create unique index bundle_claim_images_received_product_idx
  on public.bundle_claim_order_images(received_product_id)
  where received_product_id is not null;

create or replace function private.set_bundle_claim_receiving_check(
  p_owner_id uuid, p_order_id bigint, p_checked boolean
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_order public.bundle_claim_orders%rowtype;
  v_image record;
  v_product uuid;
  v_path text;
begin
  perform private.assert_bundle_inventory_access(p_owner_id);
  -- Serialize all receipt attempts for this source, including concurrent retries.
  select * into v_order from public.bundle_claim_orders
    where id = p_order_id and owner_id = p_owner_id and status = 'confirmed'
    for update;
  if not found then raise exception 'bundle claim confirmation not found'; end if;

  if coalesce(p_checked, false) then
    -- Existing manual fulfillment mappings already refer to inventory products.
    -- Do not silently replace them or receive their stock a second time.
    if not exists(select 1 from public.bundle_fulfillment_items where bundle_order_id = p_order_id) then
      if not exists(select 1 from public.bundle_claim_order_images where order_id = p_order_id)
        or exists(select 1 from public.bundle_claim_order_images
          where order_id = p_order_id and (nullif(btrim(product_name), '') is null or product_amount is null or product_amount <= 0)) then
        raise exception 'bundle receiving requires product details';
      end if;
      if (select sum(product_amount) from public.bundle_claim_order_images where order_id = p_order_id) <> v_order.total_amount then
        raise exception 'fulfillment total mismatch';
      end if;

      for v_image in select * from public.bundle_claim_order_images
        where order_id = p_order_id order by sort_order, id
      loop
        v_product := v_image.received_product_id;
        if v_product is null then
          v_path := p_owner_id::text || '/bundle-receiving/' || p_order_id::text || '/' || v_image.id::text;
          if not exists(select 1 from storage.objects where bucket_id = 'product-images' and name = v_path) then
            raise exception 'bundle receiving image not prepared';
          end if;
          v_product := public.create_inventory_product(
            p_name => v_image.product_name, p_work => null, p_category => '海報',
            p_country => null, p_source => '配單入庫', p_location => null,
            p_stock => 1, p_price => v_image.product_amount, p_cost => 0,
            p_image_paths => array[v_path], p_poster_format => null,
            p_poster_size => null, p_poster_crafts => array[]::text[],
            p_identifying_features => null, p_owner_id => p_owner_id,
            p_description => '配單：' || v_order.title || '（' || v_order.confirmation_code || '）'
          );
          update public.bundle_claim_order_images set received_product_id = v_product where id = v_image.id;
        end if;
        insert into public.bundle_fulfillment_items(bundle_order_id, product_id, quantity, unit_price)
          values(p_order_id, v_product, 1, v_image.product_amount);
      end loop;
    end if;
    -- The existing source trigger projects the new product mapping to packing.
    update public.bundle_claim_orders
      set receiving_checked_at = coalesce(receiving_checked_at, now()),
          receiving_checked_by = coalesce(receiving_checked_by, (select auth.uid())),
          updated_at = now()
      where id = p_order_id;
  else
    -- Checklist reversal does not remove received stock or its durable links.
    update public.bundle_claim_orders
      set receiving_checked_at = null, receiving_checked_by = null,
          outbound_checked_at = null, outbound_checked_by = null, updated_at = now()
      where id = p_order_id;
  end if;
  return true;
end;
$$;

-- Preserve the existing authenticated-only public RPC and private permissions.
notify pgrst, 'reload schema';
commit;
