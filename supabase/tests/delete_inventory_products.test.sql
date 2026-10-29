begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth, pg_temp;
select plan(11);

-- Use existing inventory members, matching the other database test fixtures.
create temp table deletion_context as
select p.id as user_id, p.inventory_owner_id as owner_id,
  other.id as other_owner_id,
  gen_random_uuid() as product_id, gen_random_uuid() as remaining_product_id,
  gen_random_uuid() as other_product_id, gen_random_uuid() as order_id,
  gen_random_uuid() as settlement_id
from public.profiles p
join public.inventory_databases other on other.id <> p.inventory_owner_id
where p.role = 'staff'
limit 1;
do $$
begin
  if not exists (select 1 from deletion_context) then
    raise exception 'Deletion tests require a staff member and two inventories';
  end if;
end $$;
grant select on deletion_context to authenticated;

insert into public.products(id, owner_id, name, category, stock, image_paths)
select product_id, owner_id, 'Delete test', 'poster', 0, array['delete-test/main.webp'] from deletion_context
union all
select remaining_product_id, owner_id, 'Keep test', 'poster', 3, array[]::text[] from deletion_context
union all
select other_product_id, other_owner_id, 'Other inventory', 'poster', 1, array[]::text[] from deletion_context;
insert into public.orders(id, owner_id, created_by, status)
select order_id, owner_id, user_id, 'packed' from deletion_context;
insert into public.order_items(order_id, product_id, quantity)
select order_id, product_id, 1 from deletion_context
union all
select order_id, remaining_product_id, 2 from deletion_context;
insert into public.product_qr_labels(product_id, status, used_order_id, used_by, used_at)
select product_id, 'used', order_id, user_id, now() from deletion_context
union all
select remaining_product_id, 'used', order_id, user_id, now() from deletion_context;
insert into public.packing_scans(order_id, product_id, scanned_by, is_valid)
select order_id, product_id, user_id, true from deletion_context;
-- Recreate a legacy settlement fixture; current accounting blocks new
-- product-cost settlements. Restore the guard before exercising deletion.
alter table public.settlements disable trigger guard_period_settlement;
insert into public.settlements(id, owner_id, created_by)
select settlement_id, owner_id, user_id from deletion_context;
alter table public.settlements enable trigger guard_period_settlement;
insert into public.settlement_orders(settlement_id, order_id, revenue)
select settlement_id, order_id, 0 from deletion_context;
insert into public.settlement_products(settlement_id, product_id, cost)
select settlement_id, product_id, 0 from deletion_context;

set local role authenticated;
select set_config('request.jwt.claim.sub', (select user_id::text from deletion_context), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select user_id from deletion_context), 'role', 'authenticated')::text, true);
select throws_ok(
  'select public.delete_inventory_product((select other_product_id from deletion_context))',
  'P0001', 'product not found', 'Staff cannot delete another inventory product'
);
select is(
  public.delete_inventory_product((select product_id from deletion_context)),
  array['delete-test/main.webp'], 'Staff can delete own inventory product with history'
);
select is((select count(*)::integer from public.products where id = (select product_id from deletion_context)), 0, 'Product removed');
select is((select count(*)::integer from public.orders where id = (select order_id from deletion_context)), 0, 'Whole order removed');
select is((select count(*)::integer from public.order_items where order_id = (select order_id from deletion_context)), 0, 'All order items removed');
select is((select count(*)::integer from public.packing_scans where order_id = (select order_id from deletion_context)), 0, 'Packing scans removed');
select is((select count(*)::integer from public.settlements where id = (select settlement_id from deletion_context)), 0, 'Settlement removed');
select is((select count(*)::integer from public.product_qr_labels where product_id = (select product_id from deletion_context)), 0, 'Deleted product QR labels removed');
select is((select stock from public.products where id = (select remaining_product_id from deletion_context)), 5, 'Other product stock restored');
select ok(exists(select 1 from public.product_qr_labels where product_id = (select remaining_product_id from deletion_context) and status = 'active' and used_order_id is null), 'Other product QR label restored');
reset role;
select ok(exists(select 1 from public.products where id = (select other_product_id from deletion_context)), 'Other inventory product preserved');
select * from finish();
rollback;
