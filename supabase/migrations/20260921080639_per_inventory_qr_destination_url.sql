begin;

alter table public.inventory_databases
  add column qr_destination_url text;

comment on column public.inventory_databases.qr_destination_url is
  'Optional HTTPS destination shown after a package QR code is completed.';

alter table public.inventory_databases
  add constraint inventory_databases_qr_destination_url_check
  check (
    qr_destination_url is null
    or (
      char_length(qr_destination_url) between 1 and 2048
      and qr_destination_url ~ '^https://[^[:space:]]+$'
    )
  );

update public.inventory_databases
set
  qr_destination_url = 'https://myship.7-11.com.tw/general/detail/GM2609086079265',
  updated_at = now()
where btrim(name) in ('NN佛系海報代購', 'NN佛系海報');

-- The final argument has a default so a briefly stale application deployment can
-- continue editing owners without clearing an inventory's QR destination URL.
drop function if exists public.update_inventory_database_access(uuid, text, uuid[]);
create function public.update_inventory_database_access(
  p_inventory_id uuid,
  p_name text,
  p_owner_ids uuid[],
  p_qr_destination_url text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_qr_destination_url text := nullif(btrim(p_qr_destination_url), '');
begin
  if (select public.my_role()) is distinct from 'admin'::public.user_role then
    raise exception 'admin access required';
  end if;
  if nullif(btrim(p_name), '') is null or char_length(btrim(p_name)) > 80 then
    raise exception 'invalid inventory database name';
  end if;
  if coalesce(array_length(p_owner_ids, 1), 0) < 1 then
    raise exception 'at least one owner is required';
  end if;
  if p_qr_destination_url is not null
    and v_qr_destination_url is not null
    and (
      char_length(v_qr_destination_url) > 2048
      or v_qr_destination_url !~ '^https://[^[:space:]]+$'
    )
  then
    raise exception 'invalid QR destination URL';
  end if;
  if exists (
    select 1
    from unnest(p_owner_ids) requested_id
    where not exists (
      select 1
      from public.profiles profile
      where profile.id = requested_id
    )
  ) then
    raise exception 'inventory owner not found';
  end if;

  if p_inventory_id is null then
    insert into public.inventory_databases(
      name,
      created_by,
      qr_destination_url
    )
    values (
      btrim(p_name),
      (select auth.uid()),
      v_qr_destination_url
    )
    returning id into p_inventory_id;
  else
    update public.inventory_databases
    set
      name = btrim(p_name),
      qr_destination_url = case
        when p_qr_destination_url is null then qr_destination_url
        else v_qr_destination_url
      end,
      updated_at = now()
    where id = p_inventory_id;
    if not found then
      raise exception 'inventory database not found';
    end if;
  end if;

  update public.profiles profile
  set inventory_owner_id = profile.id
  where profile.inventory_owner_id = p_inventory_id
    and not exists (
      select 1
      from public.inventory_database_members membership
      where membership.inventory_id = p_inventory_id
        and membership.user_id = profile.id
    );

  delete from public.inventory_database_members
  where inventory_id = p_inventory_id
    and user_id <> all(p_owner_ids);

  insert into public.inventory_database_members(inventory_id, user_id, is_owner)
  select p_inventory_id, requested_id, true
  from unnest(p_owner_ids) requested_id
  on conflict (user_id) do update set
    inventory_id = excluded.inventory_id,
    is_owner = true;

  update public.profiles profile
  set inventory_owner_id = membership.inventory_id
  from public.inventory_database_members membership
  where membership.user_id = profile.id;

  return p_inventory_id;
end;
$$;

revoke all on function public.update_inventory_database_access(uuid, text, uuid[], text)
  from public, anon, authenticated;
grant execute on function public.update_inventory_database_access(uuid, text, uuid[], text)
  to authenticated;

-- This is a deliberately narrow public projection. The unguessable QR token is
-- the access key, and only the inventory's checkout URL is added to the result.
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
    inventory.qr_destination_url as purchase_url,
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
