begin;
create temp table batch_context as
select p.id user_id,p.inventory_owner_id owner_id,other.id other_owner_id
from public.profiles p join public.inventory_databases other on other.id <> p.inventory_owner_id
where p.role='staff' limit 1;
do $$ begin if not exists(select 1 from batch_context) then raise exception 'Requires staff and two inventories'; end if; end $$;
grant select on batch_context to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub',(select user_id::text from batch_context),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',(select user_id from batch_context),'role','authenticated')::text,true);
do $$
declare c record; items jsonb; ids uuid[]; retried uuid[]; batch uuid := gen_random_uuid(); failed_batch uuid := gen_random_uuid(); before_count bigint;
begin
  select * into c from batch_context;
  items := '[{"work":"文字批量測試作品","country":"韓國","itemName":"A款","price":350,"size":"A3","format":"IMAX"},
    {"work":"文字批量測試作品","country":"北美","itemName":"肖像款","price":500.5,"size":"A3","format":"特別場"}]';
  select count(*) into before_count from public.products;
  ids := public.create_preorder_product_batch(c.owner_id,batch,items);
  if cardinality(ids) <> 2 or (select count(*) from public.products) <> before_count + 2
    or (select name from public.products where id=ids[1]) <> '🇰🇷 文字批量測試作品 A款'
    or (select name from public.products where id=ids[2]) <> '🇺🇸 文字批量測試作品 肖像款'
    or exists(select 1 from public.products where id=any(ids) and stock<>0)
    or exists(select 1 from public.product_qr_labels where product_id=any(ids)) then raise exception 'Batch product creation failed'; end if;
  retried := public.create_preorder_product_batch(c.owner_id,batch,items);
  if retried is distinct from ids or (select count(*) from public.products) <> before_count + 2 then raise exception 'Retry duplicated products'; end if;
  begin
    perform public.create_preorder_product_batch(c.owner_id,batch,jsonb_set(items,'{0,price}','400'));
    raise exception 'Changed payload accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.create_preorder_product_batch(c.other_owner_id,gen_random_uuid(),items);
    raise exception 'Cross inventory accepted';
  exception when raise_exception then if sqlerrm <> 'owner access required' then raise; end if; end;
  -- Fail after creating the first item: all products and the receipt must roll back.
  begin
    perform public.create_preorder_product_batch(c.owner_id,failed_batch,jsonb_set(items,'{1,price}','-1'));
    raise exception 'Negative price accepted';
  exception when raise_exception then if sqlerrm <> '請填寫有效的 NT$ 售價，最多兩位小數' then raise; end if; end;
  if (select count(*) from public.products) <> before_count + 2
    or exists(select 1 from private.preorder_product_batches where id=failed_batch) then raise exception 'Partial batch persisted'; end if;
  begin
    perform public.create_preorder_product_batch(c.owner_id,gen_random_uuid(),jsonb_build_array(items->0,items->0));
    raise exception 'Duplicate items accepted';
  exception when raise_exception then if sqlerrm <> '同一批有重複的商品與規格' then raise; end if; end;
  if has_table_privilege('authenticated','private.preorder_product_batches','UPDATE')
    or has_table_privilege('anon','private.preorder_product_batches','SELECT')
    or has_function_privilege('anon','public.create_preorder_product_batch(uuid,uuid,jsonb)','EXECUTE') then raise exception 'Batch privileges too broad'; end if;
end;
$$;
reset role;
rollback;
select 'Preorder batch tests passed; fixture rows rolled back' as result;
