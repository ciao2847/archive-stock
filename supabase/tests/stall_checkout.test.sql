begin;
-- Run as the database owner against a test database with a staff member and
-- two inventories. All fixtures and sales are rolled back.
create temp table checkout_context as
select p.id as user_id, p.inventory_owner_id as owner_id, other.id as other_owner_id,
  gen_random_uuid() as product_id, gen_random_uuid() as other_product_id,
  gen_random_uuid() as token1, gen_random_uuid() as token2, gen_random_uuid() as token3,
  gen_random_uuid() as other_token
from public.profiles p
join public.inventory_databases other on other.id <> p.inventory_owner_id
where p.role = 'staff' limit 1;
do $$ begin
  if not exists (select 1 from checkout_context) then
    raise exception 'Checkout tests require a staff member and two inventories';
  end if;
end $$;
grant select on checkout_context to authenticated;
insert into public.products(id,owner_id,name,category,price,stock)
select product_id,owner_id,'Checkout test','poster',200,3 from checkout_context
union all select other_product_id,other_owner_id,'Other inventory','poster',100,1 from checkout_context;
insert into public.product_qr_labels(product_id,token)
select product_id,token1 from checkout_context union all
select product_id,token2 from checkout_context union all
select product_id,token3 from checkout_context union all
select other_product_id,other_token from checkout_context;

set local role authenticated;
select set_config('request.jwt.claim.sub',(select user_id::text from checkout_context),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',(select user_id from checkout_context),'role','authenticated')::text,true);
do $$
declare c record; result jsonb; retry jsonb; sale_id uuid; bad record;
begin
  select * into c from checkout_context;
  -- Every rejected operation must leave stock, labels and orders unchanged.
  for bad in select * from (values
    (array[c.token1,c.token1],700::numeric,'invalid checkout labels'),
    (array[c.token1],200::numeric,'checkout price changed'),
    (array[c.other_token],250::numeric,'checkout label not found')
  ) as cases(tokens,total,message) loop
    begin
      perform public.checkout_stall_labels(c.owner_id,bad.tokens,bad.total);
      raise exception 'Expected checkout rejection: %',bad.message;
    exception when raise_exception then
      if sqlerrm <> bad.message then raise; end if;
    end;
  end loop;
  if (select stock from public.products where id=c.product_id) <> 3
    or exists(select 1 from public.product_qr_labels where token=c.token1 and status<>'active') then
    raise exception 'Rejected checkout changed stock or labels';
  end if;

  result := public.checkout_stall_labels(c.owner_id,array[c.token1,c.token2],700);
  sale_id := (result->>'orderId')::uuid;
  if (result->>'total')::numeric <> 700 then raise exception 'Expected two list prices of 350'; end if;
  if not exists(select 1 from public.order_items where order_id=sale_id
      and quantity=2 and unit_price=350 and packed_quantity=2 and scanned_quantity=0) then
    raise exception 'Incorrect order quantities or list price';
  end if;
  if not exists(select 1 from public.orders where id=sale_id and payment_status='paid' and status='packed') then
    raise exception 'Sale should be paid and delivered';
  end if;
  if (select stock from public.products where id=c.product_id) <> 1
    or (select status from public.products where id=c.product_id) <> 'in_stock' then
    raise exception 'Remaining unit should stay available';
  end if;
  if (select count(*) from public.product_qr_labels where used_order_id=sale_id and status='used') <> 2 then
    raise exception 'Sold labels were not consumed';
  end if;
  retry := public.checkout_stall_labels(c.owner_id,array[c.token2,c.token1],700);
  if retry <> result or (select stock from public.products where id=c.product_id) <> 1 then
    raise exception 'Retry created a duplicate sale';
  end if;
  begin
    perform public.checkout_stall_labels(c.owner_id,array[c.token1,c.token3],700);
    raise exception 'Expected already used label rejection';
  exception when raise_exception then
    if sqlerrm <> 'checkout label unavailable' then raise; end if;
  end;
  perform public.checkout_stall_labels(c.owner_id,array[c.token3],350);
  if (select stock from public.products where id=c.product_id) <> 0
    or (select status from public.products where id=c.product_id) <> 'packed' then
    raise exception 'Last unit was not marked sold out';
  end if;
end $$;
reset role;
-- Anonymous callers must have no access to the checkout RPC.
do $$ begin
  if has_function_privilege('anon','public.checkout_stall_labels(uuid,uuid[],numeric)','execute') then
    raise exception 'Anonymous checkout must be prohibited';
  end if;
end $$;
rollback;
