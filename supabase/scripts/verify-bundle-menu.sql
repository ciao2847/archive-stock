-- One SQL block keeps every fixture and role change on the same connection.
-- The inner exception rolls back all fixtures; unexpected failures propagate.
do $menu_tests$
declare
  v_owner uuid;
  v_other uuid;
  v_menu uuid;
  v_order bigint;
  v_foreign bigint;
  v_expired bigint;
  v_request uuid := gen_random_uuid();
  v_first record;
  v_retry record;
  v_message text;
  v_checks integer := 0;
begin
  begin
    select id into v_owner from public.inventory_databases order by created_at limit 1;
    select id into v_other from public.inventory_databases where id <> v_owner order by created_at limit 1;
    if v_owner is null or v_other is null then raise exception 'Menu tests require two inventories'; end if;

    if has_function_privilege('anon', 'public.confirm_bundle_menu_order(uuid,bigint,text,text,text,uuid)', 'execute')
      or has_function_privilege('authenticated', 'public.confirm_bundle_menu_order(uuid,bigint,text,text,text,uuid)', 'execute')
      or not has_function_privilege('service_role', 'public.confirm_bundle_menu_order(uuid,bigint,text,text,text,uuid)', 'execute')
    then raise exception 'Menu confirmation execution grants are incorrect'; end if;
    v_checks := v_checks + 1;

    update public.inventory_databases set bundle_menu_enabled = false where id = v_owner
      returning bundle_menu_token into v_menu;
    if v_menu is null then raise exception 'Menu token is missing'; end if;
    v_checks := v_checks + 1;

    insert into public.bundle_claim_orders(owner_id,title,total_amount,status,customer_hint)
      values(v_owner,'Menu test',1200,'open','james') returning id into v_order;
    insert into public.bundle_claim_orders(owner_id,title,total_amount,status)
      values(v_other,'Foreign menu test',1500,'open') returning id into v_foreign;
    insert into public.bundle_claim_orders(owner_id,title,total_amount,status,expires_at)
      values(v_owner,'Expired menu test',1600,'open',now() - interval '1 day') returning id into v_expired;

    begin
      perform * from public.confirm_bundle_menu_order(v_menu,v_order,'james','0912345678','',v_request);
      raise exception 'Disabled menu accepted confirmation';
    exception when sqlstate 'P0001' then
      get stacked diagnostics v_message = message_text;
      if v_message <> 'bundle menu is unavailable' then raise; end if;
    end;
    v_checks := v_checks + 1;

    update public.inventory_databases set bundle_menu_enabled = true where id = v_owner;
    begin
      perform * from public.confirm_bundle_menu_order(gen_random_uuid(),v_order,'james','0912345678','',v_request);
      raise exception 'Unknown menu accepted confirmation';
    exception when sqlstate 'P0001' then
      get stacked diagnostics v_message = message_text;
      if v_message <> 'bundle menu is unavailable' then raise; end if;
    end;
    v_checks := v_checks + 1;

    begin
      perform * from public.confirm_bundle_menu_order(v_menu,v_foreign,'james','0912345678','',v_request);
      raise exception 'Foreign inventory accepted confirmation';
    exception when sqlstate 'P0001' then
      get stacked diagnostics v_message = message_text;
      if v_message <> 'bundle menu order is unavailable' then raise; end if;
    end;
    v_checks := v_checks + 1;

    begin
      perform * from public.confirm_bundle_menu_order(v_menu,v_expired,'james','0912345678','',v_request);
      raise exception 'Expired allocation accepted confirmation';
    exception when sqlstate 'P0001' then
      get stacked diagnostics v_message = message_text;
      if v_message <> 'bundle claim is expired' then raise; end if;
    end;
    v_checks := v_checks + 1;

    select * into v_first from public.confirm_bundle_menu_order(v_menu,v_order,'james','0912345678','menu test',v_request);
    if v_first.order_id <> v_order or v_first.confirmation_code is null then raise exception 'Valid menu confirmation failed'; end if;
    v_checks := v_checks + 1;

    select * into v_retry from public.confirm_bundle_menu_order(v_menu,v_order,'changed','0999999999','changed',v_request);
    if v_retry.confirmation_code <> v_first.confirmation_code or v_retry.submitted_at <> v_first.submitted_at then raise exception 'Retry receipt changed'; end if;
    v_checks := v_checks + 1;
    if not exists(select 1 from public.bundle_claim_orders where id=v_order and customer_nickname='james' and customer_phone='0912345678' and customer_notes='menu test') then raise exception 'Retry overwrote customer details'; end if;
    v_checks := v_checks + 1;

    begin
      perform * from public.confirm_bundle_menu_order(v_menu,v_order,'another','0999999999','',gen_random_uuid());
      raise exception 'Another request accepted a confirmed allocation';
    exception when sqlstate 'P0001' then
      get stacked diagnostics v_message = message_text;
      if v_message <> 'bundle menu order is already confirmed' then raise; end if;
    end;
    v_checks := v_checks + 1;

    update public.bundle_claim_orders set status='draft' where id=v_expired;
    begin
      perform * from public.confirm_bundle_menu_order(v_menu,v_expired,'james','0912345678','',gen_random_uuid());
      raise exception 'Draft accepted confirmation';
    exception when sqlstate 'P0001' then
      get stacked diagnostics v_message = message_text;
      if v_message <> 'bundle claim is unavailable' then raise; end if;
    end;
    v_checks := v_checks + 1;

    update public.inventory_databases set bundle_menu_enabled=false where id=v_owner;
    begin
      perform * from public.confirm_bundle_menu_order(v_menu,v_order,'james','0912345678','',v_request);
      raise exception 'Disabled menu accepted retry';
    exception when sqlstate 'P0001' then
      get stacked diagnostics v_message = message_text;
      if v_message <> 'bundle menu is unavailable' then raise; end if;
    end;
    v_checks := v_checks + 1;

    raise exception using errcode='PT001', message='rollback menu fixtures';
  exception when sqlstate 'PT001' then
    -- Roll back fixtures while retaining the PL/pgSQL local result counter.
    null;
  end;
  if v_checks <> 12 then raise exception 'Expected 12 checks, ran %', v_checks; end if;
  raise notice 'PASS: 12 menu SQL checks; fixtures rolled back';
end;
$menu_tests$;
