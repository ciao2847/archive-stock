-- Run as postgres. Fixtures and role changes roll back automatically.
do $products$
declare
  v_user uuid; v_owner uuid; v_other uuid; v_order bigint; v_direct_order bigint;
  v_image1 bigint; v_image2 bigint; v_image3 bigint; v_total numeric; v_message text; v_checks integer := 0;
  v_products jsonb;
begin
  begin
    select id,inventory_owner_id into v_user,v_owner from public.profiles
      where role='staff' and inventory_owner_id is not null limit 1;
    select id into v_other from public.inventory_databases where id<>v_owner limit 1;
    if v_user is null or v_other is null then raise exception 'Requires staff and two inventories'; end if;
    if has_function_privilege('anon','public.set_bundle_claim_products(uuid,bigint,jsonb)','execute') then
      raise exception 'Anonymous product mutation grant';
    end if;
    v_checks := v_checks+1;
    perform set_config('request.jwt.claim.sub',v_user::text,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',v_user,'role','authenticated')::text,true);
    set local role authenticated;
    select order_id into v_order from public.create_bundle_claim_order(v_owner,'Product SQL test','Product details',1,'james',null);
    select image_id into v_image1 from public.add_bundle_claim_order_image(v_owner,v_order,v_owner::text||'/'||v_order||'/'||gen_random_uuid()||'.png','image/png','a.png',100);
    select image_id into v_image2 from public.add_bundle_claim_order_image(v_owner,v_order,v_owner::text||'/'||v_order||'/'||gen_random_uuid()||'.png','image/png','b.png',100);
    v_products := jsonb_build_array(jsonb_build_object('id',v_image1,'name',' A ','amount',0.1),jsonb_build_object('id',v_image2,'name','B','amount',0.2));
    v_total := public.set_bundle_claim_products(v_owner,v_order,v_products);
    if v_total <> 0.3 or (select total_amount from public.bundle_claim_orders where id=v_order) <> 0.3 then raise exception 'Decimal sum incorrect'; end if;
    v_checks := v_checks+1;
    if (select product_name from public.bundle_claim_order_images where id=v_image1) <> 'A' then raise exception 'Product name not trimmed'; end if;
    v_checks := v_checks+1;
    begin
      perform public.set_bundle_claim_products(v_other,v_order,v_products);
      raise exception 'Cross inventory write accepted';
    exception when others then
      get stacked diagnostics v_message=message_text;
      if v_message='Cross inventory write accepted' then raise; end if;
    end;
    v_checks := v_checks+1;
    begin
      perform public.set_bundle_claim_products(v_owner,v_order,jsonb_build_array(v_products->0,v_products->0));
      raise exception 'Duplicate products accepted';
    exception when sqlstate 'P0001' then
      get stacked diagnostics v_message=message_text;
      if v_message<>'invalid bundle claim products' then raise; end if;
    end;
    v_checks := v_checks+1;
    begin
      perform public.set_bundle_claim_products(v_owner,v_order,jsonb_build_array(v_products->0));
      raise exception 'Missing product accepted';
    exception when sqlstate 'P0001' then
      get stacked diagnostics v_message=message_text;
      if v_message<>'invalid bundle claim products' then raise; end if;
    end;
    v_checks := v_checks+1;
    begin
      perform public.set_bundle_claim_products(v_owner,v_order,jsonb_set(v_products,'{0,amount}','0.001'));
      raise exception 'Fractional cent accepted';
    exception when sqlstate 'P0001' then
      get stacked diagnostics v_message=message_text;
      if v_message<>'invalid bundle claim products' then raise; end if;
    end;
    v_checks := v_checks+1;
    begin
      perform public.set_bundle_claim_products(v_owner,v_order,jsonb_set(v_products,'{0,name}','" "'));
      raise exception 'Blank name accepted';
    exception when sqlstate 'P0001' then
      get stacked diagnostics v_message=message_text;
      if v_message<>'invalid bundle claim products' then raise; end if;
    end;
    v_checks := v_checks+1;
    if (select total_amount from public.bundle_claim_orders where id=v_order)<>0.3 then raise exception 'Rejected writes changed total'; end if;
    v_checks := v_checks+1;
    begin
      perform public.set_bundle_claim_products(v_owner,v_order,jsonb_set(v_products,'{0,amount}','-1'));
      raise exception 'Negative price accepted';
    exception when sqlstate 'P0001' then
      get stacked diagnostics v_message=message_text;
      if v_message<>'invalid bundle claim products' then raise; end if;
    end;
    v_checks := v_checks+1;
    begin
      perform public.set_bundle_claim_products(v_owner,v_order,jsonb_set(v_products,'{0,id}','9223372036854775806'));
      raise exception 'Foreign image accepted';
    exception when sqlstate 'P0001' then
      get stacked diagnostics v_message=message_text;
      if v_message<>'invalid bundle claim products' then raise; end if;
    end;
    v_checks := v_checks+1;
    select order_id into v_direct_order from public.create_bundle_claim_order(v_owner,'Product SQL direct test','Direct total',5.25,'james',null);
    perform public.add_bundle_claim_order_image(v_owner,v_direct_order,v_owner::text||'/'||v_direct_order||'/'||gen_random_uuid()||'.png','image/png','direct.png',100);
    perform public.open_bundle_claim_order(v_owner,v_direct_order);
    if (select total_amount from public.bundle_claim_orders where id=v_direct_order)<>5.25 then raise exception 'Unpriced evidence changed direct total'; end if;
    v_checks := v_checks+1;
    select image_id into v_image3 from public.add_bundle_claim_order_image(v_owner,v_order,v_owner::text||'/'||v_order||'/'||gen_random_uuid()||'.png','image/png','c.png',100);
    begin
      perform public.open_bundle_claim_order(v_owner,v_order);
      raise exception 'Incomplete itemized draft opened';
    exception when sqlstate 'P0001' then
      get stacked diagnostics v_message=message_text;
      if v_message<>'invalid bundle claim products' then raise; end if;
    end;
    v_checks := v_checks+1;
    perform public.set_bundle_claim_products(v_owner,v_order,v_products || jsonb_build_array(jsonb_build_object('id',v_image3,'name','C','amount',0.5)));
    perform public.delete_bundle_claim_order_image(v_owner,v_order,v_image3);
    if (select total_amount from public.bundle_claim_orders where id=v_order)<>0.3 then raise exception 'Removal failed to recompute total'; end if;
    v_checks := v_checks+1;
    -- Opening recomputes itemized totals even when a legacy client changes the draft total.
    perform public.update_bundle_claim_order_draft(v_owner,v_order,'Product SQL test','Product details',999,'james',null);
    perform public.open_bundle_claim_order(v_owner,v_order);
    if (select total_amount from public.bundle_claim_orders where id=v_order)<>0.3 then raise exception 'Open failed to recompute product total'; end if;
    v_checks := v_checks+1;
    begin
      perform public.set_bundle_claim_products(v_owner,v_order,v_products);
      raise exception 'Published product edits accepted';
    exception when sqlstate 'P0001' then
      get stacked diagnostics v_message=message_text;
      if v_message<>'bundle claim draft not found' then raise; end if;
    end;
    v_checks := v_checks+1;
    reset role;
    raise exception using errcode='PT001',message='rollback product fixtures';
  exception when sqlstate 'PT001' then null;
  end;
  if v_checks<>16 then raise exception 'Expected 16 product checks, got %',v_checks; end if;
  raise notice 'PASS: 16 product SQL checks; all fixtures rolled back';
end;
$products$;
