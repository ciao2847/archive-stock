do $campaign_tests$
declare
  v_user uuid; v_owner uuid; v_other uuid; v_legacy uuid;
  v_a public.bundle_claim_campaigns%rowtype; v_b public.bundle_claim_campaigns%rowtype;
  v_foreign bigint; v_order bigint; v_b_order bigint; v_old_order bigint;
  v_request uuid := gen_random_uuid(); v_first record; v_retry record; v_message text;
  v_checks integer := 0;
begin
  begin
    select id,inventory_owner_id into v_user,v_owner from public.profiles where role='staff' and inventory_owner_id is not null limit 1;
    select id into v_other from public.inventory_databases where id<>v_owner limit 1;
    if v_user is null or v_other is null then raise exception 'Requires staff and two inventories'; end if;
    if exists(select 1 from public.bundle_claim_orders orders left join public.bundle_claim_campaigns campaign on campaign.id=orders.campaign_id where campaign.id is null or campaign.owner_id<>orders.owner_id) then raise exception 'Backfill incomplete'; end if;
    v_checks:=v_checks+1;
    if exists(select 1 from public.inventory_databases inventory left join public.bundle_claim_campaigns campaign on campaign.public_token=inventory.bundle_menu_token where campaign.id is null or campaign.owner_id<>inventory.id) then raise exception 'Legacy link missing'; end if;
    v_checks:=v_checks+1;
    if has_table_privilege('anon','public.bundle_claim_campaigns','select') or has_table_privilege('authenticated','public.bundle_claim_campaigns','update') or has_function_privilege('anon','public.save_bundle_claim_campaign(uuid,bigint,text,text,boolean)','execute') then raise exception 'Campaign grants incorrect'; end if;
    v_checks:=v_checks+1;
    insert into public.bundle_claim_campaigns(owner_id,title,enabled) values(v_other,'Campaign SQL foreign',true) returning id into v_foreign;
    perform set_config('request.jwt.claim.sub',v_user::text,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',v_user,'role','authenticated')::text,true);
    set local role authenticated;
    if exists(select 1 from public.bundle_claim_campaigns where owner_id=v_other) then raise exception 'RLS exposed foreign campaigns'; end if;
    v_checks:=v_checks+1;
    select * into v_a from public.save_bundle_claim_campaign(v_owner,null,' Campaign SQL A ','Description',null);
    if v_a.enabled or v_a.title<>'Campaign SQL A' or v_a.created_by<>v_user then raise exception 'Create defaults incorrect'; end if;
    v_checks:=v_checks+1;
    select * into v_b from public.save_bundle_claim_campaign(v_owner,null,'Campaign SQL B','',true);
    if v_a.public_token=v_b.public_token then raise exception 'Campaign tokens duplicated'; end if;
    v_checks:=v_checks+1;
    select * into v_a from public.save_bundle_claim_campaign(v_owner,v_a.id,null,null,true);
    if not v_a.enabled or v_a.title<>'Campaign SQL A' or v_a.description<>'Description' then raise exception 'Partial update lost fields'; end if;
    v_checks:=v_checks+1;
    begin
      perform public.save_bundle_claim_campaign(v_other,v_foreign,'Forbidden','',true);
      raise exception 'Cross inventory campaign update accepted';
    exception when others then get stacked diagnostics v_message=message_text;
      if v_message='Cross inventory campaign update accepted' then raise; end if;
    end;
    v_checks:=v_checks+1;
    begin
      perform public.save_bundle_claim_campaign(v_owner,v_foreign,'Forbidden','',true);
      raise exception 'Foreign campaign id accepted';
    exception when sqlstate 'P0001' then get stacked diagnostics v_message=message_text;
      if v_message<>'bundle campaign not found' then raise; end if;
    end;
    v_checks:=v_checks+1;
    begin
      perform public.save_bundle_claim_campaign(v_owner,null,' ','',false);
      raise exception 'Blank campaign accepted';
    exception when sqlstate 'P0001' then get stacked diagnostics v_message=message_text;
      if v_message<>'invalid bundle campaign' then raise; end if;
    end;
    v_checks:=v_checks+1;
    begin
      perform public.create_campaign_bundle_claim_order(v_owner,v_foreign,'Foreign','',10,'',null);
      raise exception 'Foreign allocation campaign accepted';
    exception when sqlstate 'P0001' then get stacked diagnostics v_message=message_text;
      if v_message<>'invalid bundle campaign' then raise; end if;
    end;
    v_checks:=v_checks+1;
    select order_id into v_order from public.create_campaign_bundle_claim_order(v_owner,v_a.id,'Campaign SQL order','One fixed total',1888.25,'james',null);
    perform public.add_bundle_claim_order_image(v_owner,v_order,v_owner::text||'/'||v_order||'/'||gen_random_uuid()||'.png','image/png','product.png',100);
    perform public.open_bundle_claim_order(v_owner,v_order);
    if (select total_amount from public.bundle_claim_orders where id=v_order)<>1888.25 then raise exception 'Direct total changed on open'; end if;
    v_checks:=v_checks+1;
    select order_id into v_b_order from public.create_campaign_bundle_claim_order(v_owner,v_b.id,'Campaign SQL B order','',88,'Irene',null);
    if (select campaign_id from public.bundle_claim_orders where id=v_b_order)<>v_b.id then raise exception 'Allocation not scoped'; end if;
    v_checks:=v_checks+1;
    perform public.update_campaign_bundle_claim_order_draft(v_owner,v_a.id,v_b_order,'Campaign SQL B order','',99,'Irene',null);
    if (select campaign_id from public.bundle_claim_orders where id=v_b_order)<>v_a.id then raise exception 'Draft reassignment failed'; end if;
    v_checks:=v_checks+1;
    perform public.update_campaign_bundle_claim_order_draft(v_owner,v_b.id,v_b_order,'Campaign SQL B order','',99,'Irene',null);
    begin
      perform public.update_campaign_bundle_claim_order_draft(v_owner,v_b.id,v_order,'Moved','',99,'james',null);
      raise exception 'Published allocation moved';
    exception when sqlstate 'P0001' then get stacked diagnostics v_message=message_text;
      if v_message<>'bundle claim draft not found' then raise; end if;
    end;
    v_checks:=v_checks+1;
    select order_id into v_old_order from public.create_bundle_claim_order(v_owner,'Campaign SQL legacy','',10,'legacy',null);
    if not exists(select 1 from public.bundle_claim_orders orders join public.bundle_claim_campaigns campaign on campaign.id=orders.campaign_id join public.inventory_databases inventory on inventory.bundle_menu_token=campaign.public_token where orders.id=v_old_order and inventory.id=v_owner) then raise exception 'Old RPC not assigned legacy campaign'; end if;
    v_checks:=v_checks+1;
    perform public.save_bundle_claim_campaign(v_owner,v_a.id,null,null,false);
    reset role;
    begin
      perform * from public.confirm_bundle_menu_order(v_a.public_token,v_order,'james','0912345678','',v_request);
      raise exception 'Disabled campaign accepted submission';
    exception when sqlstate 'P0001' then get stacked diagnostics v_message=message_text;
      if v_message<>'bundle menu is unavailable' then raise; end if;
    end;
    v_checks:=v_checks+1;
    update public.bundle_claim_campaigns set enabled=true where id=v_a.id;
    begin
      perform * from public.confirm_bundle_menu_order(v_b.public_token,v_order,'james','0912345678','',v_request);
      raise exception 'Another same-inventory campaign accepted order';
    exception when sqlstate 'P0001' then get stacked diagnostics v_message=message_text;
      if v_message<>'bundle menu order is unavailable' then raise; end if;
    end;
    v_checks:=v_checks+1;
    begin
      perform * from public.confirm_bundle_menu_order(v_a.public_token,v_b_order,'Irene','0912345678','',v_request);
      raise exception 'Other campaign draft accepted';
    exception when sqlstate 'P0001' then get stacked diagnostics v_message=message_text;
      if v_message<>'bundle menu order is unavailable' then raise; end if;
    end;
    v_checks:=v_checks+1;
    select * into v_first from public.confirm_bundle_menu_order(v_a.public_token,v_order,'james','0912345678','note',v_request);
    select * into v_retry from public.confirm_bundle_menu_order(v_a.public_token,v_order,'changed','0999999999','changed',v_request);
    if v_first.confirmation_code<>v_retry.confirmation_code or v_first.submitted_at<>v_retry.submitted_at then raise exception 'Retry not idempotent'; end if;
    v_checks:=v_checks+1;
    if (select customer_nickname from public.bundle_claim_orders where id=v_order)<>'james' then raise exception 'Retry replaced customer'; end if;
    v_checks:=v_checks+1;
    begin
      perform * from public.confirm_bundle_menu_order(v_a.public_token,v_order,'another','0999999999','',gen_random_uuid());
      raise exception 'Repeat confirmation accepted';
    exception when sqlstate 'P0001' then get stacked diagnostics v_message=message_text;
      if v_message<>'bundle menu order is already confirmed' then raise; end if;
    end;
    v_checks:=v_checks+1;
    select bundle_menu_token into v_legacy from public.inventory_databases where id=v_owner;
    update public.inventory_databases set bundle_menu_enabled=true where id=v_owner;
    update public.bundle_claim_campaigns set enabled=false where public_token=v_legacy;
    begin
      perform * from public.confirm_bundle_menu_order(v_legacy,v_old_order,'legacy','0912345678','',gen_random_uuid());
      raise exception 'Legacy fallback bypassed paused campaign';
    exception when sqlstate 'P0001' then get stacked diagnostics v_message=message_text;
      if v_message<>'bundle menu is unavailable' then raise; end if;
    end;
    v_checks:=v_checks+1;
    update public.inventory_databases set bundle_menu_enabled=false where id=v_owner;
    update public.inventory_databases set bundle_menu_enabled=true where id=v_owner;
    if not exists(select 1 from public.bundle_claim_campaigns where public_token=v_legacy and enabled) then raise exception 'Legacy control sync failed'; end if;
    v_checks:=v_checks+1;
    begin
      update public.bundle_claim_orders set campaign_id=v_foreign where id=v_old_order;
      raise exception 'Cross inventory FK bypass';
    exception when foreign_key_violation then null;
    end;
    v_checks:=v_checks+1;
    raise exception using errcode='PT001',message='rollback campaign fixtures';
  exception when sqlstate 'PT001' then null;
  end;
  if v_checks<>25 then raise exception 'Expected 25 campaign checks, got %',v_checks; end if;
  raise notice 'PASS: 25 campaign SQL checks; fixtures rolled back';
end;
$campaign_tests$;
