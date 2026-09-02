-- 修正推薦商品判斷：商品被部分預留時，剩餘可售庫存仍可推薦。

begin;

create or replace function public.get_public_qr_landing(
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

notify pgrst, 'reload schema';

commit;

with recommendation_inventory as (
  select
    product.id,
    product.stock - coalesce(
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
    ) as available_stock
  from public.products product
  where product.status in ('in_stock', 'reserved', 'packing')
)
select
  to_regprocedure('public.get_public_qr_landing(uuid,text)') is not null
    as recommendation_availability_fix_ready,
  count(*) filter (where available_stock > 0)
    as recommendation_candidates
from recommendation_inventory;
