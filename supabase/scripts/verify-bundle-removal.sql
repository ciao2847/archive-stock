-- All fixtures, writes, role changes and sequence-visible rows roll back.
-- Invoke as postgres; no real customer records are removed.
do $removal$
declare
 v_user uuid; v_owner uuid; v_other uuid; v_order bigint; v_image bigint;
 v_paths text[]; v_path text; v_updated timestamptz; v_message text;
 v_state text; v_checks integer := 0;
begin
 begin
  select id,inventory_owner_id into v_user,v_owner from public.profiles
    where role='staff' and inventory_owner_id is not null limit 1;
  select id into v_other from public.inventory_databases where id<>v_owner limit 1;
  if v_user is null or v_other is null then raise exception 'Requires staff and two inventories'; end if;
  if has_function_privilege('anon','public.delete_bundle_claim_order(uuid,bigint,timestamptz)','execute')
     or has_function_privilege('service_role','public.delete_bundle_claim_order(uuid,bigint,timestamptz)','execute') then
    raise exception 'Unexpected deletion grant';
  end if;
  v_checks := v_checks+1;
  perform set_config('request.jwt.claim.sub',v_user::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_user,'role','authenticated')::text,true);
  set local role authenticated;
  select order_id into v_order from public.create_bundle_claim_order(v_owner,'Removal SQL fixture',null,100,'Test removal',null);
  v_path := v_owner::text||'/'||v_order||'/'||gen_random_uuid()||'.png';
  select image_id into v_image from public.add_bundle_claim_order_image(v_owner,v_order,v_path,'image/png','fixture.png',100);
  select updated_at into v_updated from public.bundle_claim_orders where id=v_order;
  begin
    perform public.delete_bundle_claim_order(v_other,v_order,v_updated);
    raise exception 'Cross inventory deletion accepted';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_message=message_text;
    if v_message<>'owner access required' then raise; end if;
  end;
  v_checks:=v_checks+1;
  begin
    perform public.delete_bundle_claim_order(v_owner,v_order,v_updated-interval '1 second');
    raise exception 'Stale deletion accepted';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_message=message_text;
    if v_message<>'bundle claim order changed' then raise; end if;
  end;
  v_checks:=v_checks+1;
  v_paths:=public.delete_bundle_claim_order(v_owner,v_order,v_updated);
  if v_paths<>array[v_path] then raise exception 'Incorrect cleanup paths'; end if;
  v_checks:=v_checks+1;
  if exists(select 1 from public.bundle_claim_orders where id=v_order)
     or exists(select 1 from public.bundle_claim_order_images where id=v_image) then
    raise exception 'Record/image cascade failed';
  end if;
  v_checks:=v_checks+1;
  begin
    perform public.delete_bundle_claim_order(v_owner,v_order);
    raise exception 'Missing deletion accepted';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_message=message_text;
    if v_message<>'bundle claim order not found' then raise; end if;
  end;
  v_checks:=v_checks+1;
  foreach v_state in array array['open','confirmed','cancelled','expired'] loop
    select order_id into v_order from public.create_bundle_claim_order(v_owner,'Removal state fixture',null,100,'Test removal',null);
    reset role;
    update public.bundle_claim_orders set status=v_state, customer_nickname='Test removal',customer_phone='0912345678',customer_phone_normalized='0912345678',confirmed_at=now(),confirmation_request_id=gen_random_uuid() where id=v_order;
    set local role authenticated;
    if public.delete_bundle_claim_order(v_owner,v_order)<>array[]::text[] then raise exception 'Empty cleanup path mismatch'; end if;
    v_checks:=v_checks+1;
  end loop;
  select order_id into v_order from public.create_bundle_claim_order(v_owner,'Protected removal fixture',null,100,'Test removal',null);
  reset role;
  update public.bundle_claim_orders set status='confirmed', customer_nickname='Test removal',customer_phone='0912345678',customer_phone_normalized='0912345678',confirmed_at=now(),confirmation_request_id=gen_random_uuid() where id=v_order;
  insert into public.bundle_claim_payments(order_id,amount,transferred_at,created_by) values(v_order,100,now(),v_user);
  set local role authenticated;
  begin
    perform public.delete_bundle_claim_order(v_owner,v_order);
    raise exception 'Paid deletion accepted';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_message=message_text;
    if v_message<>'bundle claim order has payment' then raise; end if;
  end;
  v_checks:=v_checks+1;
  perform public.delete_bundle_claim_payment(v_owner,v_order);
  perform public.set_bundle_claim_receiving_check(v_owner,v_order,true);
  begin
    perform public.delete_bundle_claim_order(v_owner,v_order);
    raise exception 'Receiving deletion accepted';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_message=message_text;
    if v_message<>'bundle claim order has checks' then raise; end if;
  end;
  v_checks:=v_checks+1;
  perform public.set_bundle_claim_outbound_check(v_owner,v_order,true);
  begin
    perform public.delete_bundle_claim_order(v_owner,v_order);
    raise exception 'Outbound deletion accepted';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_message=message_text;
    if v_message<>'bundle claim order has checks' then raise; end if;
  end;
  v_checks:=v_checks+1;
  perform public.set_bundle_claim_receiving_check(v_owner,v_order,false);
  perform public.delete_bundle_claim_order(v_owner,v_order);
  v_checks:=v_checks+1;
  raise exception using errcode='Z0001',message='ROLLBACK_REMOVAL_FIXTURES';
 exception when sqlstate 'Z0001' then
  if sqlerrm<>'ROLLBACK_REMOVAL_FIXTURES' then raise; end if;
 end;
 reset role;
 perform set_config('poster.removal_checks',v_checks::text,true);
end;
$removal$;
select current_setting('poster.removal_checks')::int as passed_removal_checks;
