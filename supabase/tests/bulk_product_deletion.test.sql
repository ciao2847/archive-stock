begin;
create temp table bulk_delete_context as
select p.id user_id,p.inventory_owner_id owner_id,other.id other_owner_id,
 gen_random_uuid() first_id,gen_random_uuid() second_id,gen_random_uuid() other_id,gen_random_uuid() admin_own_id,gen_random_uuid() order_id,
 null::uuid blocked_id,(select id from public.profiles where role='admin' limit 1) admin_id
from public.profiles p join public.inventory_databases other on other.id<>p.inventory_owner_id
where p.role='staff' limit 1;
do $$ begin if not exists(select 1 from bulk_delete_context) then raise exception 'Requires staff and two inventories'; end if; end $$;
update bulk_delete_context set blocked_id=greatest(first_id,second_id);
grant select,update on bulk_delete_context to authenticated;
insert into public.products(id,owner_id,name,category,stock,image_paths)
 select first_id,owner_id,'Bulk first fixture','海報',1,array['bulk-test/shared.webp'] from bulk_delete_context union all
 select second_id,owner_id,'Bulk second fixture','海報',1,array['bulk-test/shared.webp'] from bulk_delete_context union all
 select other_id,other_owner_id,'Other inventory fixture','海報',0,'{}' from bulk_delete_context union all
 select admin_own_id,owner_id,'Admin test fixture','海報',0,'{}' from bulk_delete_context;
insert into public.product_qr_labels(product_id) select first_id from bulk_delete_context union all select second_id from bulk_delete_context;
insert into public.orders(id,owner_id,created_by,status)
 select order_id,owner_id,user_id,'packed' from bulk_delete_context;
insert into public.order_items(order_id,product_id,quantity)
 select order_id,first_id,1 from bulk_delete_context union all
 select order_id,second_id,1 from bulk_delete_context union all
 select order_id,admin_own_id,1 from bulk_delete_context;
insert into public.product_qr_labels(product_id,status,used_order_id,used_by,used_at)
 select first_id,'used',order_id,user_id,now() from bulk_delete_context union all
 select second_id,'used',order_id,user_id,now() from bulk_delete_context union all
 select admin_own_id,'used',order_id,user_id,now() from bulk_delete_context;
insert into public.packing_scans(order_id,product_id,scanned_by,is_valid)
 select order_id,first_id,user_id,true from bulk_delete_context;

-- The deliberately failing trigger is visible only inside this transaction
-- and is rolled back together with every fixture.
create function pg_temp.fail_bulk_fixture() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if old.id=(select blocked_id from pg_temp.bulk_delete_context) then raise exception 'fixture deletion failure'; end if;
 return old;
end;
$$;
create trigger bulk_fixture_failure before delete on public.products for each row execute function pg_temp.fail_bulk_fixture();
set local role authenticated;
select set_config('request.jwt.claim.sub',(select user_id::text from bulk_delete_context),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',(select user_id from bulk_delete_context),'role','authenticated')::text,true);
do $$
declare c record; result jsonb;
begin
 select * into c from bulk_delete_context;
 begin
  perform public.delete_inventory_products(array[c.first_id,c.first_id]);
  raise exception 'Duplicate IDs accepted';
 exception when invalid_parameter_value then null; end;
 begin
  perform public.delete_inventory_products('{}'::uuid[]);
  raise exception 'Empty batch accepted';
 exception when invalid_parameter_value then null; end;
 begin
  perform public.delete_inventory_products(array[null::uuid]);
  raise exception 'Null product accepted';
 exception when invalid_parameter_value then null; end;
 begin
  perform public.delete_inventory_products(array(select gen_random_uuid() from generate_series(1,51)));
  raise exception 'Oversized batch accepted';
 exception when invalid_parameter_value then null; end;

 begin
  perform public.delete_inventory_products(array[c.first_id,c.other_id]);
  raise exception 'Cross-inventory batch accepted';
 exception when raise_exception then if sqlerrm<>'product not found' then raise; end if; end;
 begin
  perform public.delete_inventory_products(array[c.first_id,gen_random_uuid()]);
  raise exception 'Missing product accepted';
 exception when raise_exception then if sqlerrm<>'product not found' then raise; end if; end;
 begin
  perform public.delete_inventory_products(array[c.first_id,c.second_id]);
  raise exception 'Fixture failure not triggered';
 exception when raise_exception then if sqlerrm<>'fixture deletion failure' then raise; end if; end;
 if (select count(*) from public.products where id in(c.first_id,c.second_id))<>2
   or (select count(*) from public.product_qr_labels where product_id in(c.first_id,c.second_id))<>4
   or not exists(select 1 from public.orders where id=c.order_id) then
  raise exception 'Failed batch left partial deletion';
 end if;
 update bulk_delete_context set blocked_id=null;
 result:=public.delete_inventory_products(array[c.second_id,c.first_id]);
 if jsonb_array_length(result->'deletedProductIds')<>2 or result->'imagePaths'<>'["bulk-test/shared.webp"]'::jsonb
   or exists(select 1 from public.products where id in(c.first_id,c.second_id))
   or exists(select 1 from public.product_qr_labels where product_id in(c.first_id,c.second_id)) then
  raise exception 'Successful staff batch did not delete products/QRs or deduplicate image cleanup';
 end if;
 if exists(select 1 from public.orders where id=c.order_id)
   or exists(select 1 from public.packing_scans where order_id=c.order_id)
   or (select stock from public.products where id=c.admin_own_id)<>1
   or not exists(select 1 from public.product_qr_labels where product_id=c.admin_own_id and status='active' and used_order_id is null) then
  raise exception 'Shared order cleanup or unselected product stock/QR restoration failed';
 end if;
 if has_function_privilege('anon','public.delete_inventory_products(uuid[])','EXECUTE') then raise exception 'Anonymous batch deletion exposed'; end if;
end;
$$;
reset role;
do $$ begin
 if not exists(select 1 from public.products where id=(select other_id from bulk_delete_context)) then raise exception 'Other inventory changed'; end if;
end; $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',(select admin_id::text from bulk_delete_context),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',(select admin_id from bulk_delete_context),'role','authenticated')::text,true);
do $$
declare c record;
begin
 select * into c from bulk_delete_context;
 if c.admin_id is not null then
  perform public.delete_inventory_products(array[c.other_id,c.admin_own_id]);
  if exists(select 1 from public.products where id in(c.other_id,c.admin_own_id)) then raise exception 'Administrator batch failed'; end if;
 end if;
end;
$$;
reset role;
rollback;
select 'Bulk deletion: inventory scope, administrator access, rollback after a later failure, QR and image cleanup passed; fixtures rolled back' as result;
