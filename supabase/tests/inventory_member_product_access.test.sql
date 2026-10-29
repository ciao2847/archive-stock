begin;
create temp table member_access_context as
select p.id user_id,p.inventory_owner_id owner_id,other.id other_owner_id,
  gen_random_uuid() other_product_id
from public.profiles p join public.inventory_databases other on other.id<>p.inventory_owner_id
where p.role='staff' limit 1;
do $$ begin if not exists(select 1 from member_access_context) then raise exception 'Requires staff and two inventories'; end if; end $$;
grant select on member_access_context to authenticated;
insert into public.products(id,owner_id,name,category,stock)
select other_product_id,other_owner_id,'Other inventory access test','海報',0 from member_access_context;
set local role authenticated;
select set_config('request.jwt.claim.sub',(select user_id::text from member_access_context),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',(select user_id from member_access_context),'role','authenticated')::text,true);
do $$
declare c record; own_product uuid; updated boolean;
begin
  select * into c from member_access_context;
  own_product:=public.create_inventory_product(p_name=>'Inventory member access test',p_category=>'海報',p_work=>'權限測試作品',
    p_country=>'韓國',p_source=>'',p_location=>'',p_stock=>3,p_price=>250,p_cost=>0,p_owner_id=>c.owner_id,
    p_image_paths=>'{}',p_poster_format=>'',p_poster_size=>'A3',p_poster_crafts=>'{}',p_identifying_features=>'');
  updated:=public.update_inventory_product(p_product_id=>own_product,p_name=>'Inventory member access test',p_category=>'海報',
    p_country=>'韓國',p_source=>'',p_location=>'',p_stock=>2,p_price=>250,p_cost=>null,p_poster_format=>'',p_poster_size=>'A3',p_identifying_features=>'');
  if updated is distinct from true or (select stock from public.products where id=own_product)<>2
    or (select count(*) from public.product_qr_labels where product_id=own_product and status='active')<>2 then
    raise exception 'Inventory member could not reduce own inventory stock and QR labels';
  end if;
  begin
    perform public.update_inventory_product(p_product_id=>c.other_product_id,p_name=>'Unauthorized edit',p_category=>'海報',
      p_country=>'韓國',p_source=>'',p_location=>'',p_stock=>0,p_price=>250,p_cost=>null,p_poster_format=>'',p_poster_size=>'A3',p_identifying_features=>'');
    raise exception 'Cross-inventory edit accepted';
  exception when raise_exception then if sqlerrm<>'product not found' then raise; end if; end;
  perform public.delete_inventory_product(own_product);
  if exists(select 1 from public.products where id=own_product)
    or exists(select 1 from public.product_qr_labels where product_id=own_product) then raise exception 'Inventory member deletion failed'; end if;
  begin
    perform public.delete_inventory_product(c.other_product_id);
    raise exception 'Cross-inventory deletion accepted';
  exception when raise_exception then if sqlerrm<>'product not found' then raise; end if; end;
end;
$$;
reset role;
do $$ begin
  if not exists(select 1 from public.products where id=(select other_product_id from member_access_context) and name='Other inventory access test') then raise exception 'Other inventory changed'; end if;
end; $$;
rollback;
select 'Inventory member stock reduction, deletion and cross-inventory isolation passed; all fixtures rolled back' as result;
