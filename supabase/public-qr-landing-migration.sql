-- 公開 QR 失效頁只透過隨機 token 讀取必要資料。
-- 不開放 orders、products 或 product_qr_labels 給匿名使用者直接查詢。

drop function if exists public.get_public_qr_landing(uuid);
drop function if exists public.get_public_qr_landing(uuid, text);

-- 若曾執行過含通路價格的舊版 migration，移除不再使用的資料表。
drop table if exists public.product_channel_prices;

-- 客戶頁只公開商品圖片檔案；資料表、成本與訂單仍維持 RLS 保護。
update storage.buckets
set public = true
where id = 'product-images';

create index if not exists products_public_recommendations_idx
  on public.products(created_at desc)
  where status = 'in_stock' and stock > 0;

create function public.get_public_qr_landing(
  p_token uuid,
  p_channel text default null
)
returns table(
  order_no text,
  qr_status text,
  order_status text,
  sales_channel text,
  recommendations jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    orders.order_no,
    label.status as qr_status,
    orders.status::text as order_status,
    case
      when lower(coalesce(orders.sales_channel, p_channel, '')) = 'shopee'
        then 'shopee'
      else 'line'
    end as sales_channel,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'sku', recommendation.sku,
            'name', recommendation.name,
            'image_path', recommendation.image_path
          )
          order by recommendation.created_at desc
        )
        from (
          select
            product.sku,
            product.name,
            coalesce(product.image_paths[2], product.image_paths[1]) as image_path,
            product.created_at
          from public.products product
          where product.status in ('in_stock', 'reserved', 'packing')
            and product.stock > coalesce(
              (
                select sum(order_item.quantity)
                from public.order_items order_item
                join public.orders active_order
                  on active_order.id = order_item.order_id
                where order_item.product_id = product.id
                  and active_order.status in ('pending', 'packing')
                  and active_order.deleted_at is null
              ),
              0
            )
            and product.id <> label.product_id
          order by product.created_at desc
          limit 4
        ) recommendation
      ),
      '[]'::jsonb
    ) as recommendations
  from public.product_qr_labels label
  left join public.orders orders
    on orders.id = label.used_order_id
    and orders.deleted_at is null
  where label.token = p_token;
$$;

revoke all on function public.get_public_qr_landing(uuid, text) from public;
grant execute on function public.get_public_qr_landing(uuid, text)
  to anon, authenticated;

-- 匿名訪客只能執行上面的受限函式，不能直接讀取內部資料表。
revoke all on table public.orders from anon;
revoke all on table public.products from anon;
revoke all on table public.product_qr_labels from anon;

notify pgrst, 'reload schema';

select
  to_regprocedure('public.get_public_qr_landing(uuid,text)') is not null
  and has_function_privilege(
    'anon',
    'public.get_public_qr_landing(uuid,text)',
    'execute'
  )
  and not has_table_privilege('anon', 'public.orders', 'select')
  and not has_table_privilege('anon', 'public.products', 'select')
  and not has_table_privilege('anon', 'public.product_qr_labels', 'select')
  as public_qr_landing_ready;

-- 應回傳 0 筆且不應拋出權限錯誤，用來確認 anon 可安全呼叫 RPC。
set role anon;
select count(*) = 0 as unknown_token_returns_no_data
from public.get_public_qr_landing(
  '00000000-0000-4000-8000-000000000000'::uuid,
  'shopee'
);
reset role;
