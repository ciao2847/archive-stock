begin;

create extension if not exists pgtap with schema extensions;
select plan(27);

select ok(c.relrowsecurity, format('%I has RLS enabled', c.relname))
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = any(array[
    'profiles', 'works', 'locations', 'products', 'location_movements',
    'customers', 'orders', 'order_items', 'packing_scans',
    'product_qr_labels', 'settlements', 'settlement_orders',
    'settlement_products'
  ]);

select ok(
  not has_function_privilege('anon', p.oid, 'execute'),
  format('anon cannot execute %I', p.proname)
)
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = any(array[
    'create_inventory_product', 'update_inventory_product',
    'adjust_product_stock', 'archive_order', 'complete_order_packing',
    'consume_product_qr', 'consume_product_sku',
    'create_financial_settlement', 'create_order_with_items',
    'delete_inventory_product', 'get_admin_product_costs',
    'set_admin_product_cost', 'update_order_details',
    'update_order_financials'
  ]);

select * from finish();
rollback;
