begin;
create temp table stall_manage_context as
select p.id user_id,p.inventory_owner_id owner_id,other.id other_owner_id,
  gen_random_uuid() product1,gen_random_uuid() product2,gen_random_uuid() other_product,
  array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()] tokens1,
  array[gen_random_uuid(),gen_random_uuid()] tokens2
from public.profiles p join public.inventory_databases other on other.id<>p.inventory_owner_id where p.role='staff' limit 1;
do $$ begin if not exists(select 1 from stall_manage_context) then raise exception 'Requires staff and two inventories'; end if; end $$;
grant select on stall_manage_context to authenticated;
insert into public.products(id,owner_id,name,category,price,stock)
select product1,owner_id,'Stall management fixture','poster',200,6 from stall_manage_context
union all select product2,owner_id,'Second stall fixture','poster',100,2 from stall_manage_context
union all select other_product,other_owner_id,'Foreign fixture','poster',100,2 from stall_manage_context;
insert into public.product_qr_labels(product_id,token)
select c.product1,t from stall_manage_context c,unnest(c.tokens1) t
union all select c.product2,t from stall_manage_context c,unnest(c.tokens2) t;
set local role authenticated;
select set_config('request.jwt.claim.sub',(select user_id::text from stall_manage_context),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',(select user_id from stall_manage_context),'role','authenticated')::text,true);
do $$
declare c record; sale uuid; res jsonb; page jsonb; payload jsonb; fail record; stock_before integer;
begin
  select * into c from stall_manage_context;
  res:=public.checkout_stall_labels(c.owner_id,array[c.tokens1[1],c.tokens1[2],c.tokens2[1]],950);
  sale:=(res->>'orderId')::uuid;
  update public.orders set created_at='2001-01-10T04:00:00Z',packed_at='2001-01-10T04:00:00Z' where id=sale;
  payload:=jsonb_build_array(jsonb_build_object('product_id',c.product1,'quantity',3,'unit_price',300),jsonb_build_object('product_id',c.product2,'quantity',1,'unit_price',250));
  res:=public.manage_stall_order(c.owner_id,sale,0,'edit',payload,'cash corrected');
  if (res->>'total')::numeric<>1150 or (select stock from public.products where id=c.product1)<>3
    or (select count(*) from public.product_qr_labels where used_order_id=sale)<>4 then raise exception 'Edit did not update price, stock and labels'; end if;
  if not exists(select 1 from public.product_qr_labels where token=c.tokens1[1] and used_order_id=sale) then raise exception 'Existing sold label should be retained'; end if;
  begin
    perform public.manage_stall_order(c.owner_id,sale,0,'edit',payload,'stale');
    raise exception 'Expected revision conflict';
  exception when raise_exception then if sqlerrm<>'stall order changed' then raise; end if; end;
  for fail in select * from (values
    (jsonb_build_array(jsonb_build_object('product_id',c.other_product,'quantity',1,'unit_price',250)),'stall product not found'),
    (jsonb_build_array(jsonb_build_object('product_id',c.product1,'quantity',7,'unit_price',350)),'product is not available'),
    ('[]'::jsonb,'invalid stall items'),
    (jsonb_build_array(jsonb_build_object('product_id',c.product1,'quantity',1.5,'unit_price',350)),'invalid stall items')
  ) x(items,message) loop
    begin
      perform public.manage_stall_order(c.owner_id,sale,1,'edit',fail.items,'rejected');
      raise exception 'Expected edit rejection';
    exception when raise_exception then if sqlerrm<>fail.message then raise; end if; end;
  end loop;
  if (select stock from public.products where id=c.product1)<>3 or (select stall_revision from public.orders where id=sale)<>1 then raise exception 'Rejected edit mutated sale'; end if;
  payload:=jsonb_build_array(jsonb_build_object('product_id',c.product1,'quantity',1,'unit_price',280));
  perform public.manage_stall_order(c.owner_id,sale,1,'edit',payload,'one item');
  if (select stock from public.products where id=c.product1)<>5 or (select stock from public.products where id=c.product2)<>2
    or (select count(*) from public.product_qr_labels where used_order_id=sale)<>1 then raise exception 'Removing/decreasing items did not restore units'; end if;
  payload:=payload||jsonb_build_array(jsonb_build_object('product_id',c.product2,'quantity',2,'unit_price',250));
  perform public.manage_stall_order(c.owner_id,sale,2,'edit',payload,'add product');
  if (select stock from public.products where id=c.product2)<>0 or (select status from public.products where id=c.product2)<>'packed'
    or (select count(*) from public.product_qr_labels where used_order_id=sale)<>3 then raise exception 'Adding product did not consume units'; end if;
  page:=public.find_stall_orders(c.owner_id,'Stall management fixture','2001-01-01','2001-01-31','completed',1);
  if (page->>'total')::integer<>1 or page->'orders'->0->>'note'<>'add product' then raise exception 'Name/date/status search failed'; end if;
  if (public.find_stall_orders(c.owner_id,'%',null,null,'all',1)->>'total')::integer<>0 then raise exception 'Search wildcard must be literal'; end if;
  perform public.manage_stall_order(c.owner_id,sale,3,'cancel');
  perform public.manage_stall_order(c.owner_id,sale,3,'cancel');
  if (select stock from public.products where id=c.product1)<>6 or (select stock from public.products where id=c.product2)<>2
    or exists(select 1 from public.product_qr_labels where used_order_id=sale)
    or exists(select 1 from public.order_items where order_id=sale and packed_quantity<>0)
    or not exists(select 1 from public.orders where id=sale and status='cancelled' and deleted_at is null and stall_revision=4) then
    raise exception 'Cancel must restore stock once and retain order history';
  end if;
  if (public.find_stall_orders(c.owner_id,'Stall management fixture','2001-01-01','2001-01-31','cancelled',1)->>'total')::integer<>1 then raise exception 'Cancelled history missing'; end if;
  begin
    perform public.find_stall_orders(c.other_owner_id);
    raise exception 'Expected foreign inventory denial';
  exception when raise_exception then if sqlerrm<>'owner access required' then raise; end if; end;
  begin
    perform public.manage_stall_order(c.other_owner_id,sale,4,'cancel');
    raise exception 'Expected foreign mutation denial';
  exception when raise_exception then if sqlerrm<>'owner access required' then raise; end if; end;
  res:=public.checkout_stall_labels(c.owner_id,array[c.tokens1[1]],350);
  if (res->>'orderId')::uuid=sale or (select stock from public.products where id=c.product1)<>5 then raise exception 'Restored label cannot be checked out again'; end if;
  update public.orders set created_at='2001-01-11T04:00:00Z',packed_at='2001-01-11T04:00:00Z' where id=(res->>'orderId')::uuid;
end $$;
reset role;
-- A financial closing locks even orders not attached to settlement_orders yet.
insert into public.settlements(owner_id,period_start,period_end,revenue,cost,created_by,cost_source)
select owner_id,'2001-01-01','2001-02-28',0,0,user_id,'period_total' from stall_manage_context;
set local role authenticated;
do $$ declare c record; sale uuid; begin
  select * into c from stall_manage_context;
  select o.id into sale from public.orders o where o.notes='攤位掃碼結帳' and o.owner_id=c.owner_id and o.created_at='2001-01-11T04:00:00Z';
  begin
    perform public.manage_stall_order(c.owner_id,sale,0,'cancel');
    raise exception 'Expected financial lock';
  exception when raise_exception then if sqlerrm<>'settled order cannot be changed' then raise; end if; end;
  if (select stock from public.products where id=c.product1)<>5 then raise exception 'Financial lock changed stock'; end if;
end $$;
reset role;
do $$ begin
  if has_function_privilege('anon','public.manage_stall_order(uuid,uuid,integer,text,jsonb,text)','execute')
    or has_function_privilege('anon','public.find_stall_orders(uuid,text,date,date,text,integer)','execute') then raise exception 'Anonymous stall management allowed'; end if;
end $$;
rollback;
