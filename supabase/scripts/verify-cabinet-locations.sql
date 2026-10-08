-- SQL Editor: run the entire block as postgres after cabinet_location_management.
-- Requires one staff member with an inventory and an unused cabinet letter.
-- Success / No rows returned means all assertions passed. All fixtures roll back.
do $verify_storage$
declare v_user uuid; v_owner uuid; v_other uuid; v_c uuid; v_a uuid; v_b uuid; v_empty uuid; v_p uuid; v_q uuid; v_value jsonb; v_count integer;
begin
  begin
    select id,inventory_owner_id into v_user,v_owner from public.profiles where role='staff' and inventory_owner_id is not null order by created_at limit 1;
    if v_user is null then raise exception 'Verification requires a staff inventory'; end if;
    select id into v_other from public.inventory_databases where id<>v_owner limit 1;
    perform set_config('request.jwt.claim.sub',v_user::text,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',v_user,'role','authenticated')::text,true);
    set local role authenticated;
    v_value:=public.manage_location_storage(v_owner,'create_cabinet',jsonb_build_object('name','驗證櫃子','rows',2,'columns',2));
    v_c:=(v_value->>'id')::uuid;
    select count(*) into v_count from public.locations where cabinet_id=v_c;
    if v_count<>4 then raise exception 'Storage check failed: cabinet dimensions'; end if;
    select id into v_a from public.locations where cabinet_id=v_c and shelf=1 and bin=1;
    select id into v_b from public.locations where cabinet_id=v_c and shelf=1 and bin=2;
    select id into v_empty from public.locations where cabinet_id=v_c and shelf=2 and bin=2;
    perform public.manage_location_storage(v_owner,'rename_slot',jsonb_build_object('id',v_a,'name','韓國海報'));
    if (select display_name from public.locations where id=v_a)<>'韓國海報' then raise exception 'Storage check failed: rename'; end if;
    v_value:=public.manage_location_storage(v_owner,'quick_add',jsonb_build_object('name','驗證海報','country','韓國','price',500,'quantity',5,'locationId',null));
    v_p:=(v_value->>'id')::uuid;
    if (select stock<>5 or location_id is not null from public.products where id=v_p) then raise exception 'Storage check failed: unassigned intake'; end if;
    perform public.manage_location_storage(v_owner,'putaway',jsonb_build_object('locationId',v_a,'items',jsonb_build_array(jsonb_build_object('productId',v_p,'quantity',3))));
    if (select stock from public.products where id=v_p)<>5 then raise exception 'Storage check failed: stock inflated'; end if;
    if (select quantity from public.product_location_stocks where product_id=v_p and location_id=v_a)<>3 then raise exception 'Storage check failed: partial putaway'; end if;
    begin
      perform public.manage_location_storage(v_owner,'putaway',jsonb_build_object('locationId',v_b,'items',jsonb_build_array(jsonb_build_object('productId',v_p,'quantity',3))));
      raise exception 'Storage check failed: excessive quantity accepted';
    exception when others then if sqlerrm<>'quantity exceeds unassigned stock' then raise; end if; end;
    perform public.manage_location_storage(v_owner,'putaway',jsonb_build_object('locationId',v_b,'items',jsonb_build_array(jsonb_build_object('productId',v_p,'quantity',1,'fromLocationId',v_a))));
    if (select quantity from public.product_location_stocks where product_id=v_p and location_id=v_a)<>2 then raise exception 'Storage check failed: move source'; end if;
    if (select quantity from public.product_location_stocks where product_id=v_p and location_id=v_b)<>1 then raise exception 'Storage check failed: move destination'; end if;
    begin
      perform public.manage_location_storage(v_owner,'delete_slot',jsonb_build_object('id',v_a));
      raise exception 'Storage check failed: occupied deletion allowed';
    exception when others then if sqlerrm<>'occupied slot' then raise; end if; end;
    begin
      perform public.manage_location_storage(v_owner,'resize_cabinet',jsonb_build_object('id',v_c,'name','驗證櫃子','rows',1,'columns',1));
      raise exception 'Storage check failed: occupied resize allowed';
    exception when others then if sqlerrm<>'occupied slot' then raise; end if; end;
    perform public.manage_location_storage(v_owner,'delete_slot',jsonb_build_object('id',v_empty));
    if exists(select 1 from public.locations where id=v_empty) then raise exception 'Storage check failed: empty deletion'; end if;
    perform public.manage_location_storage(v_owner,'add_slot',jsonb_build_object('id',v_c));
    if (select count(*) from public.locations where cabinet_id=v_c)<>4 then raise exception 'Storage check failed: restore gap'; end if;
    update public.products set stock=1 where id=v_p;
    if (select coalesce(sum(quantity),0) from public.product_location_stocks where product_id=v_p)>1 then raise exception 'Storage check failed: stock decrease reconciliation'; end if;
    v_value:=public.manage_location_storage(v_owner,'quick_add',jsonb_build_object('name','驗證已入庫','country','日本','price',100,'quantity',2,'locationId',v_a));
    v_q:=(v_value->>'id')::uuid;
    if (select quantity from public.product_location_stocks where product_id=v_q and location_id=v_a)<>2 then raise exception 'Storage check failed: assigned intake'; end if;
    update public.products set location_id=v_b where id=v_q;
    if (select quantity from public.product_location_stocks where product_id=v_q and location_id=v_b)<>2 or exists(select 1 from public.product_location_stocks where product_id=v_q and location_id=v_a) then raise exception 'Storage check failed: legacy movement compatibility'; end if;
    begin
      insert into public.product_location_stocks values(v_p,v_a,v_owner,999);
      raise exception 'Storage check failed: direct allocation write allowed';
    exception when insufficient_privilege then null; end;
    if v_other is not null then
      begin
        perform public.manage_location_storage(v_other,'create_cabinet',jsonb_build_object('name','越權','rows',1,'columns',1));
        raise exception 'Storage check failed: cross-inventory write allowed';
      exception when others then if sqlerrm<>'owner access required' then raise; end if; end;
      if exists(select 1 from public.storage_cabinets where owner_id=v_other) or exists(select 1 from public.product_location_stocks where owner_id=v_other) then raise exception 'Storage check failed: cross-inventory read allowed'; end if;
    end if;
    raise exception using errcode='P0431',message='Storage verification rollback';
  exception when sqlstate 'P0431' then if sqlerrm<>'Storage verification rollback' then raise; end if;
  end;
  raise notice 'Cabinet/location checks passed; all fixtures rolled back';
end;
$verify_storage$;
