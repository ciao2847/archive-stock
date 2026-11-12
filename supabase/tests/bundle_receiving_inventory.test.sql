begin;
do $$
declare
  v_owner uuid := '00000000-0000-4000-8000-000000000001';
  v_bundle bigint; v_missing bigint; v_image bigint; v_second bigint;
  v_before integer; v_product uuid; v_order uuid; v_package uuid;
begin
  select count(*) into v_before from public.products;
  insert into public.bundle_claim_orders(owner_id,total_amount,status,customer_nickname,customer_phone)
    values(v_owner,1000,'confirmed','入庫測試','0911111111') returning id into v_bundle;
  insert into public.bundle_claim_order_images(order_id,storage_path,product_name,product_amount)
    values(v_bundle,'source/first.png','天空之城',400) returning id into v_image;
  insert into public.bundle_claim_order_images(order_id,storage_path,product_name,product_amount)
    values(v_bundle,'source/second.png','龍貓',600) returning id into v_second;
  insert into storage.objects values('product-images', v_owner || '/bundle-receiving/' || v_bundle || '/' || v_image);
  -- Fail after attempting the first product: the whole receipt must roll back.
  begin
    perform public.set_bundle_claim_receiving_check(v_owner,v_bundle,true);
    raise exception 'Expected unprepared image';
  exception when raise_exception then
    if sqlerrm <> 'bundle receiving image not prepared' then raise; end if;
  end;
  if (select count(*) from public.products) <> v_before
    or exists(select 1 from public.bundle_claim_order_images where order_id=v_bundle and received_product_id is not null)
    or exists(select 1 from public.bundle_claim_orders where id=v_bundle and receiving_checked_at is not null)
    or exists(select 1 from public.bundle_fulfillment_items where bundle_order_id=v_bundle) then
    raise exception 'Failed receipt partially persisted';
  end if;
  insert into storage.objects values('product-images', v_owner || '/bundle-receiving/' || v_bundle || '/' || v_second);
  execute 'set local role authenticated';
  perform public.set_bundle_claim_receiving_check(v_owner,v_bundle,true);
  perform public.set_bundle_claim_receiving_check(v_owner,v_bundle,true);
  perform public.set_bundle_claim_receiving_check(v_owner,v_bundle,false);
  perform public.set_bundle_claim_receiving_check(v_owner,v_bundle,true);
  execute 'reset role';
  if (select count(*) from public.products) <> v_before+2
    or (select count(*) from public.bundle_fulfillment_items where bundle_order_id=v_bundle) <> 2 then
    raise exception 'Duplicate receipt products';
  end if;
  select received_product_id into v_product from public.bundle_claim_order_images where id=v_image;
  if not exists(select 1 from public.products where id=v_product and name='天空之城' and price=400
    and stock=1 and owner_id=v_owner and category='海報' and source='配單入庫'
    and image_paths=array[v_owner || '/bundle-receiving/' || v_bundle || '/' || v_image])
    or (select count(*) from public.product_qr_labels q join public.bundle_fulfillment_items i on i.product_id=q.product_id
      where i.bundle_order_id=v_bundle) <> 2 then
    raise exception 'Receipt details, stock, image or QR labels missing';
  end if;
  select id into v_order from public.orders where bundle_claim_order_id=v_bundle;
  if (select sum(quantity*unit_price) from public.order_items where order_id=v_order) <> 1000 then
    raise exception 'Receipt not linked to packing';
  end if;
  -- Execute the authenticated public RPC; foreign inventories and anon stay out.
  execute 'set local role authenticated';
  perform public.set_bundle_claim_receiving_check(v_owner,v_bundle,true);
  begin
    perform public.set_bundle_claim_receiving_check('00000000-0000-4000-8000-000000000002',v_bundle,true);
    raise exception 'Expected owner denial';
  exception when raise_exception then if sqlerrm <> 'owner access required' then raise; end if; end;
  if has_function_privilege('anon','public.set_bundle_claim_receiving_check(uuid,bigint,boolean)','execute') then
    raise exception 'Anonymous receipt access';
  end if;
  execute 'reset role';
  v_package := public.create_packing_package(v_owner,'contact:0911111111');
  perform public.consume_product_package_sku(v_package,(select sku from public.products where id=v_product));
  perform public.consume_product_package_sku(v_package,(select sku from public.products where id=(select received_product_id from public.bundle_claim_order_images where id=v_second)));
  if not (public.complete_packing_package(v_package)->>'completed')::boolean then raise exception 'Receipt cannot be packed'; end if;
  perform public.set_bundle_claim_receiving_check(v_owner,v_bundle,true);
  if (select stock from public.products where id=v_product) <> 0 then raise exception 'Retry restored consumed stock'; end if;

  -- Legacy evidence without item details cannot invent inventory amounts.
  insert into public.bundle_claim_orders(owner_id,total_amount,status,customer_nickname,customer_phone)
    values(v_owner,100,'confirmed','缺資料','0922222222') returning id into v_missing;
  insert into public.bundle_claim_order_images(order_id,storage_path) values(v_missing,'legacy.png');
  begin
    perform public.set_bundle_claim_receiving_check(v_owner,v_missing,true);
    raise exception 'Expected missing details';
  exception when raise_exception then if sqlerrm <> 'bundle receiving requires product details' then raise; end if; end;
  update public.bundle_claim_order_images set product_name='金額不符', product_amount=50 where order_id=v_missing;
  begin
    perform public.set_bundle_claim_receiving_check(v_owner,v_missing,true);
    raise exception 'Expected total mismatch';
  exception when raise_exception then if sqlerrm <> 'fulfillment total mismatch' then raise; end if; end;
  -- A manually mapped existing product is reused without increasing its stock.
  perform public.map_bundle_fulfillment(v_owner,v_missing,jsonb_build_array(jsonb_build_object('product_id',v_product,'quantity',1,'unit_price',100)));
  perform public.set_bundle_claim_receiving_check(v_owner,v_missing,true);
  if (select stock from public.products where id=v_product) <> 0
    or (select count(*) from public.products) <> v_before+2 then raise exception 'Manual mapping received twice'; end if;
end $$;
rollback;
