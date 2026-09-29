begin;

alter table public.inventory_databases
  add column qr_shopee_destination_url text,
  add column qr_other_destination_url text;

comment on column public.inventory_databases.qr_shopee_destination_url is
  'Optional HTTPS purchase destination for completed Shopee orders.';
comment on column public.inventory_databases.qr_other_destination_url is
  'Optional HTTPS purchase destination for completed non-Shopee orders.';

alter table public.inventory_databases
  add constraint inventory_databases_qr_shopee_destination_url_check
  check (
    qr_shopee_destination_url is null
    or (
      char_length(qr_shopee_destination_url) between 1 and 2048
      and qr_shopee_destination_url ~ '^https://[^[:space:]]+$'
    )
  ),
  add constraint inventory_databases_qr_other_destination_url_check
  check (
    qr_other_destination_url is null
    or (
      char_length(qr_other_destination_url) between 1 and 2048
      and qr_other_destination_url ~ '^https://[^[:space:]]+$'
    )
  );

-- Preserve an inventory-wide destination (currently the 佛系 MyShip URL) for
-- both routes. Inventories without an override keep the existing Shopee/LINE
-- application defaults.
update public.inventory_databases
set
  qr_shopee_destination_url = qr_destination_url,
  qr_other_destination_url = qr_destination_url,
  qr_destination_url = null,
  updated_at = now()
where qr_destination_url is not null;

-- The privileged write is intentionally kept in the unexposed private schema.
-- It updates only the two QR destination columns and verifies membership itself.
create or replace function private.update_inventory_qr_destinations(
  p_inventory_id uuid,
  p_shopee_destination_url text,
  p_other_destination_url text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_shopee_destination_url text := nullif(
    btrim(coalesce(p_shopee_destination_url, '')),
    ''
  );
  v_other_destination_url text := nullif(
    btrim(coalesce(p_other_destination_url, '')),
    ''
  );
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;
  if p_inventory_id is null then
    raise exception 'inventory database not found';
  end if;
  if (select public.my_role()) is distinct from 'admin'::public.user_role
    and not exists (
      select 1
      from public.inventory_database_members membership
      where membership.inventory_id = p_inventory_id
        and membership.user_id = v_user_id
    )
  then
    raise exception 'inventory access required';
  end if;
  if v_shopee_destination_url is not null
    and (
      char_length(v_shopee_destination_url) > 2048
      or v_shopee_destination_url !~ '^https://[^[:space:]]+$'
    )
  then
    raise exception 'invalid Shopee destination URL';
  end if;
  if v_other_destination_url is not null
    and (
      char_length(v_other_destination_url) > 2048
      or v_other_destination_url !~ '^https://[^[:space:]]+$'
    )
  then
    raise exception 'invalid other destination URL';
  end if;

  update public.inventory_databases
  set
    qr_shopee_destination_url = v_shopee_destination_url,
    qr_other_destination_url = v_other_destination_url,
    -- Clear the legacy all-channel override once the two routes are saved.
    qr_destination_url = null,
    updated_at = now()
  where id = p_inventory_id;

  if not found then
    raise exception 'inventory database not found';
  end if;

  return p_inventory_id;
end;
$$;

revoke all on function private.update_inventory_qr_destinations(uuid, text, text)
  from public, anon, authenticated;
grant execute on function private.update_inventory_qr_destinations(uuid, text, text)
  to authenticated;

-- Public RPC wrapper remains security-invoker; the narrowly scoped private
-- function performs the required privileged update after authorization.
create or replace function public.update_inventory_qr_destinations(
  p_inventory_id uuid,
  p_shopee_destination_url text,
  p_other_destination_url text
)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.update_inventory_qr_destinations(
    p_inventory_id,
    p_shopee_destination_url,
    p_other_destination_url
  )
$$;

revoke all on function public.update_inventory_qr_destinations(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.update_inventory_qr_destinations(uuid, text, text)
  to authenticated;

-- Keep the public QR payload narrow, but select the configured destination for
-- the order channel before returning it to the application.
drop function if exists public.get_public_qr_landing(uuid, text);
create function public.get_public_qr_landing(
  p_token uuid,
  p_channel text default null
)
returns table(
  order_no text,
  qr_status text,
  order_status text,
  sales_channel text,
  purchase_url text,
  recommendations jsonb
)
language sql
volatile
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
    case
      when lower(coalesce(orders.sales_channel, p_channel, '')) = 'shopee'
        then coalesce(
          inventory.qr_destination_url,
          inventory.qr_shopee_destination_url
        )
      else coalesce(
        inventory.qr_destination_url,
        inventory.qr_other_destination_url
      )
    end as purchase_url,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'sku', recommendation.sku,
            'name', recommendation.name,
            'description', recommendation.description,
            'image_path', recommendation.image_path
          )
          order by recommendation.random_order
        )
        from (
          select
            product.sku,
            product.name,
            product.description,
            coalesce(product.image_paths[2], product.image_paths[1]) as image_path,
            random() as random_order
          from public.products product
          where product.owner_id = source_product.owner_id
            and product.status in ('in_stock', 'reserved', 'packing')
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
          order by random_order
          limit 4
        ) recommendation
      ),
      '[]'::jsonb
    ) as recommendations
  from public.product_qr_labels label
  join public.products source_product
    on source_product.id = label.product_id
  join public.inventory_databases inventory
    on inventory.id = source_product.owner_id
  left join public.orders orders
    on orders.id = label.used_order_id
    and orders.deleted_at is null
  where label.token = p_token;
$$;

revoke all on function public.get_public_qr_landing(uuid, text)
  from public, anon, authenticated;
grant execute on function public.get_public_qr_landing(uuid, text)
  to anon, authenticated;

notify pgrst, 'reload schema';

commit;
