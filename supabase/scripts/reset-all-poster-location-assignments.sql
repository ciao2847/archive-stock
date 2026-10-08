-- One-time reset requested for ALL inventories. Run this entire file as postgres in SQL Editor.
-- Keeps products, their physical stock, images, cabinets, slots and movement history.
-- Requires the cabinet_location_management migration. This is not an automatic migration.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';

-- 鎖定資料表，避免執行中被併發寫入
lock table public.products, public.product_location_stocks in share row exclusive mode;

-- 1. 清除舊主庫位指標，避免後續編輯商品時自動跳回舊庫位
update public.products set location_id = null where location_id is not null;

-- 2. 清除所有格位分配，使所有在席有庫存海報全數回到「待整理海報」
delete from public.product_location_stocks;

-- 3. 依照指示「櫃子都先不要設定有幾格 先留空」：
-- 清理未命名且未被使用的佔位格子「新庫位」，完整保留使用者自定義名稱之格位與櫃子
delete from public.locations
where display_name = '新庫位'
  and not exists (select 1 from public.product_location_stocks where location_id = locations.id)
  and not exists (select 1 from public.products where location_id = locations.id)
  and not exists (select 1 from public.location_movements where from_location_id = locations.id or to_location_id = locations.id);

-- 4. 產出執行結果確認報告
select 
  (select count(*) from public.products) as preserved_products,
  (select count(*) from public.products where location_id is null) as unassigned_products,
  (select count(*) from public.product_location_stocks) as remaining_slot_allocations,
  (select count(*) from public.storage_cabinets) as preserved_cabinets,
  (select count(*) from public.locations) as preserved_slots;

commit;
