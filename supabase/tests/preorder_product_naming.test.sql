begin;
create temp table naming_context as
select p.id user_id,p.inventory_owner_id owner_id,other.id other_owner_id,
  gen_random_uuid() other_product, null::uuid named_product,null::bigint form_id,null::bigint submission_id
from public.profiles p join public.inventory_databases other on other.id<>p.inventory_owner_id
where p.role='staff' limit 1;
do $$ begin if not exists(select 1 from naming_context) then raise exception 'Requires staff and two inventories'; end if; end $$;
grant select,update on naming_context to authenticated;
insert into public.products(id,owner_id,name,category,price,stock)
select other_product,other_owner_id,'Legacy product unchanged','海報',100,0 from naming_context;
set local role authenticated;
select set_config('request.jwt.claim.sub',(select user_id::text from naming_context),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',(select user_id from naming_context),'role','authenticated')::text,true);
do $$
declare c record; input jsonb; first_id uuid; second_id uuid; single_id uuid; form bigint; target uuid; region record;
begin
  select * into c from naming_context;
  input:=jsonb_build_object('name','ignored client name','work','預購命名測試作品','preorderItemName','全員款','country','韓國',
    'category','海報','source','','location','','stock',0,'price',250,'format','','size','A3','crafts','[]'::jsonb,'feature','','description','');
  first_id:=public.save_named_inventory_product(input,c.owner_id);
  second_id:=public.save_named_inventory_product(input||'{"country":"日本","preorderItemName":"肖像款"}',c.owner_id);
  single_id:=public.save_named_inventory_product(input||'{"preorderItemName":""}',c.owner_id);
  if (select name from public.products where id=first_id)<>'🇰🇷 預購命名測試作品 全員款'
    or (select name from public.products where id=second_id)<>'🇯🇵 預購命名測試作品 肖像款'
    or (select name from public.products where id=single_id)<>'🇰🇷 預購命名測試作品'
    or first_id=second_id or (select sku from public.products where id=first_id)=(select sku from public.products where id=second_id)
    or (select work_id from public.products where id=first_id) is distinct from (select work_id from public.products where id=second_id)
    or exists(select 1 from public.product_qr_labels where product_id in(first_id,second_id,single_id)) then
    raise exception 'Naming, country variants, shared work or zero-stock creation failed';
  end if;
  for region in select * from (values ('馬來西亞','🇲🇾'),('北美','🇺🇸'),('飯製','🎨')) x(country,symbol) loop
    target:=public.save_named_inventory_product(input||jsonb_build_object('country',region.country,'format','特別場'),c.owner_id);
    if (select name from public.products where id=target)<>region.symbol||' 預購命名測試作品 全員款'
      or (select poster_format from public.products where id=target) is distinct from '特別場' then raise exception 'New country/version persistence failed'; end if;
  end loop;
  if public.format_preorder_product_name('日本','🇰🇷 預購命名測試作品','🇯🇵 A款')<>'🇯🇵 預購命名測試作品 A款' then raise exception 'Duplicate flags'; end if;
  insert into public.claim_forms(owner_id,title,is_open) values(c.owner_id,'命名測試表單',true) returning id into form;
  insert into public.claim_form_products(form_id,product_id,display_name,unit_price) values(form,first_id,'🇰🇷 預購命名測試作品 全員款',250);
  if (select display_name from public.claim_form_products where form_id=form and product_id=first_id)<>'🇰🇷 預購命名測試作品 全員款' then raise exception 'Inherited listing name must persist'; end if;
  update naming_context set named_product=first_id,form_id=form;
  begin
    perform public.save_named_inventory_product(input,c.other_owner_id);
    raise exception 'Cross-inventory creation allowed';
  exception when raise_exception then if sqlerrm<>'owner access required' then raise; end if; end;
  begin
    perform public.save_named_inventory_product(input,null,c.other_product);
    raise exception 'Cross-inventory edit allowed';
  exception when raise_exception then if sqlerrm<>'product not found' then raise; end if; end;
  begin
    perform public.save_named_inventory_product(input||'{"country":""}',c.owner_id);
    raise exception 'Country required';
  exception when raise_exception then if sqlerrm<>'請選擇國家版本' then raise; end if; end;
end;
$$;
reset role;
-- Preserve an already submitted customer's name snapshot when a listing changes.
with submission as (
  insert into public.claim_submissions(form_id,request_id,nickname,phone,phone_normalized)
  select form_id,gen_random_uuid(),'命名測試客人','0912345678','0912345678' from naming_context returning id
) update naming_context set submission_id=(select id from submission);
insert into public.claim_submission_items(submission_id,product_id,product_sku,product_name,quantity,unit_price)
select c.submission_id,p.id,p.sku,p.name,1,250 from naming_context c join public.products p on p.id=c.named_product;
set local role authenticated;
do $$
declare c record; payload jsonb; saved uuid;
begin
  select * into c from naming_context;
  payload:=jsonb_build_object('work','預購命名測試作品','preorderItemName','A款','country','日本','category','海報',
    'source','','location','','stock',2,'price',300,'format','','size','A3','crafts','[]'::jsonb,'feature','','description','');
  saved:=public.save_named_inventory_product(payload,null,c.named_product);
  if saved<>c.named_product or (select stock from public.products where id=saved)<>2
    or (select count(*) from public.product_qr_labels where product_id=saved)<>2
    or (select name from public.products where id=saved)<>'🇯🇵 預購命名測試作品 A款'
    or (select display_name from public.claim_form_products where form_id=c.form_id and product_id=saved)<>'🇯🇵 預購命名測試作品 A款'
    or (select product_name from public.claim_submission_items where submission_id=c.submission_id)<>'🇰🇷 預購命名測試作品 全員款' then
    raise exception 'Arrival must retain ID, generate QR, sync listing and preserve submitted names';
  end if;
  update public.products set country='香港',name='duplicate flag attempt' where id=saved;
  if (select name from public.products where id=saved)<>'🇭🇰 預購命名測試作品 A款' then raise exception 'Legacy edits must keep canonical name'; end if;
  update public.claim_form_products set display_name='自訂公開商品名稱' where form_id=c.form_id and product_id=saved;
  update public.products set country='日本' where id=saved;
  if (select display_name from public.claim_form_products where form_id=c.form_id and product_id=saved)<>'自訂公開商品名稱' then raise exception 'Inventory edits must preserve custom public names'; end if;
end;
$$;
reset role;
do $$ begin
  if (select name from public.products where id=(select other_product from naming_context))<>'Legacy product unchanged'
    or (select preorder_item_name from public.products where id=(select other_product from naming_context)) is not null then raise exception 'Legacy data changed'; end if;
  if has_function_privilege('anon','public.save_named_inventory_product(jsonb,uuid,uuid)','EXECUTE') then raise exception 'Anonymous RPC exposed'; end if;
end; $$;
rollback;

select 'Preorder naming tests passed; fixture rows rolled back' as result;
