begin;
do $$
declare
  v_owner uuid := '00000000-0000-4000-8000-000000000001';
  v_product uuid := '00000000-0000-4000-8000-000000000010';
  v_order uuid; v_bundle bigint; v_bundle_order uuid; v_package uuid;
  v_result jsonb; v_count integer; v_new bigint;
begin
  if not exists(select 1 from public.orders where bundle_claim_order_id=1 and status='shipped') then raise exception 'Historical shipment requeued'; end if;
  select id into v_order from public.orders where claim_submission_id = 1;
  if v_order is null or (select order_no from public.orders where id=v_order) <> 'PRE-EXISTING'
    or (select sum(quantity) from public.order_items where order_id=v_order) <> 2 then raise exception 'Backfill missing'; end if;
  if (select stock from public.products where id=v_product) <> 0 then raise exception 'Conversion consumed stock'; end if;
  perform private.sync_claim_fulfillment('claim',1);
  if (select count(*) from public.orders where claim_submission_id=1) <> 1 then raise exception 'Duplicate fulfillment'; end if;
  update public.claim_submissions set payment_status='paid' where id=1;
  if (select payment_status from public.orders where id=v_order) <> 'paid' then raise exception 'Claim payment not synced'; end if;
  update public.claim_submissions set payment_status='half_paid' where id=1;
  if (select payment_status from public.orders where id=v_order) <> 'pending' then raise exception 'Partial payment falsely marked paid'; end if;
  update public.claim_submissions set payment_status='pending' where id=1;

  insert into public.claim_submissions(form_id,nickname,phone) values(1,'小美','0912345678') returning id into v_new;
  insert into public.claim_submission_items(submission_id,product_id,quantity,unit_price) values(v_new,v_product,1,300);
  if not exists(select 1 from public.orders o join public.order_items i on i.order_id=o.id where o.claim_submission_id=v_new) then raise exception 'New submission not converted'; end if;
  delete from public.claim_submissions where id=v_new;
  if exists(select 1 from public.orders where claim_submission_id=v_new) then raise exception 'Orphan fulfillment'; end if;

  insert into public.bundle_claim_orders(owner_id,total_amount,status) values(v_owner,600,'draft') returning id into v_bundle;
  if exists(select 1 from public.orders where bundle_claim_order_id=v_bundle) then raise exception 'Draft converted'; end if;
  update public.bundle_claim_orders set status='confirmed',customer_nickname='小美',customer_phone='0912345678' where id=v_bundle;
  select id into v_bundle_order from public.orders where bundle_claim_order_id=v_bundle;
  if v_bundle_order is null or exists(select 1 from public.order_items where order_id=v_bundle_order) then raise exception 'Unmapped bundle should await products'; end if;
  begin
    perform public.map_bundle_fulfillment(v_owner,v_bundle,jsonb_build_array(jsonb_build_object('product_id',v_product,'quantity',2,'unit_price',250)));
    raise exception 'Expected price mismatch';
  exception when raise_exception then if sqlerrm <> 'fulfillment total mismatch' then raise; end if; end;
  perform public.map_bundle_fulfillment(v_owner,v_bundle,jsonb_build_array(jsonb_build_object('product_id',v_product,'quantity',2,'unit_price',300)));
  if (select sum(quantity*unit_price) from public.order_items where order_id=v_bundle_order) <> 600 then raise exception 'Bundle price mismatch'; end if;
  insert into public.bundle_claim_payments(order_id,amount) values(v_bundle,600);
  if (select payment_status from public.orders where id=v_bundle_order) <> 'paid' then raise exception 'Bundle payment not synced'; end if;
  delete from public.bundle_claim_payments where order_id=v_bundle;
  if (select payment_status from public.orders where id=v_bundle_order) <> 'pending' then raise exception 'Reversal not synced'; end if;

  -- Run the actual existing package and scanning functions on the projected order.
  update public.products set stock=1 where id=v_product;
  insert into public.product_qr_labels(product_id) values(v_product);
  v_package := public.create_packing_package(v_owner,'contact:0912345678');
  if not (select valid from public.consume_product_package_sku(v_package,(select sku from public.products where id=v_product))) then raise exception 'Cannot scan source order'; end if;
  v_result := public.complete_packing_package(v_package);
  if not (v_result->>'completed')::boolean or (select stock from public.products where id=v_product) <> 0 then raise exception 'Packing failed to consume one'; end if;
  if (select packed_quantity from public.order_items where order_id=v_order) <> 1
    or (select status from public.orders where id=v_order) <> 'packing' then raise exception 'Partial order incorrectly completed'; end if;
  if (public.complete_packing_package(v_package)->>'completed')::boolean then raise exception 'Completed twice'; end if;
  if (select stock from public.products where id=v_product) <> 0 then raise exception 'Retry consumed stock'; end if;
  begin
    delete from public.claim_submissions where id=1;
    raise exception 'Expected packed deletion guard';
  exception when raise_exception then if sqlerrm <> 'fulfillment already started' then raise; end if; end;
  begin
    update public.claim_submission_items set quantity=3 where submission_id=1;
    raise exception 'Expected quantity change guard';
  exception when raise_exception then if sqlerrm <> 'fulfillment already started' then raise; end if; end;
  begin
    delete from public.orders where id=v_order;
    raise exception 'Expected direct deletion guard';
  exception when raise_exception then if sqlerrm <> 'manage fulfillment through source' then raise; end if; end;
  -- Arrival of the remaining unit allows a second package for the same order.
  update public.products set stock=1 where id=v_product;
  insert into public.product_qr_labels(product_id) values(v_product);
  v_package := public.create_packing_package(v_owner,'contact:0912345678');
  perform public.consume_product_package_sku(v_package,(select sku from public.products where id=v_product));
  perform public.complete_packing_package(v_package);
  if (select status from public.orders where id=v_order) <> 'packed'
    or (select packed_quantity from public.order_items where order_id=v_order) <> 2 then raise exception 'Second package did not finish order'; end if;
  -- Pack the mapped bundle with the same package/SKU functions and synchronize
  -- the legacy checklist only after actual stock has been consumed.
  update public.products set stock=2 where id=v_product;
  insert into public.product_qr_labels(product_id) values(v_product),(v_product);
  v_package := public.create_packing_package(v_owner,'contact:0912345678');
  perform public.consume_product_package_sku(v_package,(select sku from public.products where id=v_product));
  perform public.consume_product_package_sku(v_package,(select sku from public.products where id=v_product));
  perform public.complete_packing_package(v_package);
  if (select status from public.orders where id=v_bundle_order) <> 'packed'
    or not exists(select 1 from public.bundle_claim_orders where id=v_bundle and outbound_checked_at is not null and receiving_checked_at is not null)
    or (select stock from public.products where id=v_product) <> 0 then raise exception 'Bundle packing did not synchronize'; end if;
  begin
    perform public.map_bundle_fulfillment(v_owner,v_bundle,jsonb_build_array(jsonb_build_object('product_id',v_product,'quantity',1,'unit_price',600)));
    raise exception 'Expected packed mapping guard';
  exception when raise_exception then if sqlerrm <> 'fulfillment already started' then raise; end if; end;
  begin
    update public.bundle_claim_orders set outbound_checked_at=null where id=v_bundle;
    raise exception 'Expected packed checklist guard';
  exception when raise_exception then if sqlerrm <> 'fulfillment already started' then raise; end if; end;
end $$;
-- Exercise the publicly granted RPC under an actual authenticated role.
set local role authenticated;
do $$ begin
  begin
    perform public.map_bundle_fulfillment('00000000-0000-4000-8000-000000000002',1,'[]');
    raise exception 'Expected foreign inventory denial';
  exception when raise_exception then if sqlerrm <> 'owner access required' then raise; end if; end;
  perform public.map_bundle_fulfillment('00000000-0000-4000-8000-000000000001',
    (select max(id) from public.bundle_claim_orders),
    '[{"product_id":"00000000-0000-4000-8000-000000000010","quantity":2,"unit_price":300}]');
  if has_function_privilege('anon','public.map_bundle_fulfillment(uuid,bigint,jsonb)','execute')
    or has_function_privilege('authenticated','private.sync_claim_fulfillment(text,bigint)','execute') then raise exception 'Excessive privileges'; end if;
end $$;
reset role;
rollback;
