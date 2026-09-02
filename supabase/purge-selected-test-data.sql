-- 一次性清除指定的測試商品與測試訂單。
-- 這份檔案只包含 A000001～A000004、ORDER-000001～ORDER-000004。
-- 任一筆資料不存在，或和其他訂單／商品交叉使用時，整筆交易都會停止並復原。
-- 測試訂單內未列入刪除清單的商品（例如 A000005）會保留並還原庫存。

begin;

create temporary table purge_target_product_skus (
  sku text primary key
) on commit drop;

insert into purge_target_product_skus(sku)
values
  ('A000001'),
  ('A000002'),
  ('A000003'),
  ('A000004');

create temporary table purge_target_order_nos (
  order_no text primary key
) on commit drop;

insert into purge_target_order_nos(order_no)
values
  ('ORDER-000001'),
  ('ORDER-000002'),
  ('ORDER-000003'),
  ('ORDER-000004');

create temporary table purge_target_products on commit drop as
select p.id, p.sku
from public.products p
join purge_target_product_skus target on target.sku = p.sku;

create unique index on purge_target_products(id);
create unique index on purge_target_products(sku);

create temporary table purge_target_orders on commit drop as
select o.id, o.order_no
from public.orders o
join purge_target_order_nos target on target.order_no = o.order_no;

create unique index on purge_target_orders(id);
create unique index on purge_target_orders(order_no);

create temporary table purge_retained_products on commit drop as
select distinct p.id, p.sku
from public.order_items oi
join purge_target_orders target_order on target_order.id = oi.order_id
join public.products p on p.id = oi.product_id
left join purge_target_products target_product on target_product.id = p.id
where target_product.id is null;

create unique index on purge_retained_products(id);
create unique index on purge_retained_products(sku);

-- 保留圖片路徑，資料刪除後可到 product-images bucket 清除實體檔案。
create temporary table purge_deleted_image_paths as
select p.sku, image_path
from public.products p
join purge_target_products target on target.id = p.id
cross join lateral unnest(coalesce(p.image_paths, array[]::text[])) image_path;

do $$
declare
  v_missing_products text;
  v_missing_orders text;
  v_cross_order text;
begin
  select string_agg(target.sku, ', ' order by target.sku)
  into v_missing_products
  from purge_target_product_skus target
  left join purge_target_products found on found.sku = target.sku
  where found.id is null;

  if v_missing_products is not null then
    raise exception '找不到指定商品：%', v_missing_products;
  end if;

  select string_agg(target.order_no, ', ' order by target.order_no)
  into v_missing_orders
  from purge_target_order_nos target
  left join purge_target_orders found on found.order_no = target.order_no
  where found.id is null;

  if v_missing_orders is not null then
    raise exception '找不到指定訂單：%', v_missing_orders;
  end if;

  -- 鎖定目標資料，避免驗證完成到刪除之間被其他操作修改。
  perform p.id
  from public.products p
  join purge_target_products target on target.id = p.id
  order by p.id
  for update of p;

  perform p.id
  from public.products p
  join purge_retained_products retained on retained.id = p.id
  order by p.id
  for update of p;

  perform o.id
  from public.orders o
  join purge_target_orders target on target.id = o.id
  order by o.id
  for update of o;

  -- 指定商品若被其他訂單使用，就停止，避免刪掉其他訂單的歷史。
  select string_agg(distinct o.order_no, ', ' order by o.order_no)
  into v_cross_order
  from public.order_items oi
  join purge_target_products target_product on target_product.id = oi.product_id
  join public.orders o on o.id = oi.order_id
  left join purge_target_orders target_order on target_order.id = o.id
  where target_order.id is null;

  if v_cross_order is not null then
    raise exception '指定商品仍被其他訂單使用：%', v_cross_order;
  end if;

  -- 錯誤掃描也屬於其他訂單的稽核紀錄，不能連帶刪除。
  select string_agg(distinct o.order_no, ', ' order by o.order_no)
  into v_cross_order
  from public.packing_scans ps
  join purge_target_products target_product on target_product.id = ps.product_id
  join public.orders o on o.id = ps.order_id
  left join purge_target_orders target_order on target_order.id = o.id
  where target_order.id is null;

  if v_cross_order is not null then
    raise exception '指定商品仍有其他訂單的掃描紀錄：%', v_cross_order;
  end if;

  select string_agg(distinct o.order_no, ', ' order by o.order_no)
  into v_cross_order
  from public.product_qr_labels label
  join purge_target_products target_product on target_product.id = label.product_id
  join public.orders o on o.id = label.used_order_id
  left join purge_target_orders target_order on target_order.id = o.id
  where target_order.id is null;

  if v_cross_order is not null then
    raise exception '指定商品的 QR Code 仍連結其他訂單：%', v_cross_order;
  end if;
end $$;

create temporary table purge_affected_settlements on commit drop as
select distinct so.settlement_id
from public.settlement_orders so
join purge_target_orders target on target.id = so.order_id
union
select distinct sp.settlement_id
from public.settlement_products sp
join purge_target_products target on target.id = sp.product_id;

create unique index on purge_affected_settlements(settlement_id);

delete from public.settlement_orders so
using purge_target_orders target
where so.order_id = target.id;

delete from public.settlement_products sp
using purge_target_products target
where sp.product_id = target.id;

-- 只扣除測試資料，保留同一結算內的正式訂單與正式商品。
update public.settlements settlement
set revenue = coalesce((
      select sum(so.revenue)
      from public.settlement_orders so
      where so.settlement_id = settlement.id
    ), 0),
    cost = coalesce((
      select sum(sp.cost)
      from public.settlement_products sp
      where sp.settlement_id = settlement.id
    ), 0)
where settlement.id in (
  select affected.settlement_id
  from purge_affected_settlements affected
);

delete from public.settlements settlement
where settlement.id in (
    select affected.settlement_id
    from purge_affected_settlements affected
  )
  and not exists (
    select 1
    from public.settlement_orders so
    where so.settlement_id = settlement.id
  )
  and not exists (
    select 1
    from public.settlement_products sp
    where sp.settlement_id = settlement.id
  );

-- 先解除訂單與 QR 標籤的關聯；目標商品的標籤稍後會隨商品刪除。
update public.product_qr_labels label
set status = 'active',
    used_order_id = null,
    used_by = null,
    used_at = null
where label.used_order_id in (
  select target.id
  from purge_target_orders target
);

-- 未刪除的商品依有效 QR 標籤還原庫存；若仍有其他進行中訂單則保留預留狀態。
with label_counts as (
  select
    retained.id as product_id,
    count(label.id) as total_labels,
    count(label.id) filter (where label.status = 'active') as active_labels
  from purge_retained_products retained
  left join public.product_qr_labels label on label.product_id = retained.id
  group by retained.id
)
update public.products product
set stock = case
      when counts.total_labels > 0 then counts.active_labels::integer
      else product.stock
    end,
    status = case
      when exists (
        select 1
        from public.order_items oi
        join public.orders orders on orders.id = oi.order_id
        left join purge_target_orders target on target.id = orders.id
        where oi.product_id = product.id
          and target.id is null
          and orders.deleted_at is null
          and orders.status in ('pending', 'packing')
      ) then 'reserved'::public.product_status
      when counts.total_labels > 0 and counts.active_labels > 0
        then 'in_stock'::public.product_status
      when counts.total_labels = 0 and product.stock > 0
        then 'in_stock'::public.product_status
      else product.status
    end,
    updated_at = now()
from label_counts counts
where product.id = counts.product_id;

delete from public.packing_scans scan
using purge_target_orders target
where scan.order_id = target.id;

delete from public.orders orders
using purge_target_orders target
where orders.id = target.id;

delete from public.location_movements movement
using purge_target_products target
where movement.product_id = target.id;

delete from public.products product
using purge_target_products target
where product.id = target.id;

do $$
begin
  if exists (
    select 1
    from public.products p
    join purge_target_product_skus target on target.sku = p.sku
  ) then
    raise exception '商品刪除驗證失敗，已復原全部變更';
  end if;

  if exists (
    select 1
    from public.orders o
    join purge_target_order_nos target on target.order_no = o.order_no
  ) then
    raise exception '訂單刪除驗證失敗，已復原全部變更';
  end if;

  if exists (
    select 1
    from purge_retained_products retained
    left join public.products p on p.id = retained.id
    where p.id is null
  ) then
    raise exception '保留商品驗證失敗，已復原全部變更';
  end if;
end $$;

commit;

-- SQL 執行成功後，這裡會列出仍需從 Supabase Storage 刪除的圖片。
select sku, image_path
from purge_deleted_image_paths
order by sku, image_path;
