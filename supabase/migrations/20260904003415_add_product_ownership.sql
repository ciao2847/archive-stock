begin;

alter table public.products
  add column if not exists owner_id uuid references public.profiles(id)
  on delete restrict;

-- Preserve ownership for existing records. Records created before created_by
-- existed are assigned to the oldest admin (or oldest profile as fallback).
update public.products
set owner_id = created_by
where owner_id is null
  and created_by is not null;

update public.products
set owner_id = (
  select id
  from public.profiles
  order by (role = 'admin') desc, created_at, id
  limit 1
)
where owner_id is null;

do $$
begin
  if exists (select 1 from public.products where owner_id is null) then
    raise exception 'cannot assign product owners: create at least one profile first';
  end if;
end;
$$;

alter table public.products
  alter column owner_id set default auth.uid(),
  alter column owner_id set not null;

create index if not exists products_owner_id_idx
  on public.products (owner_id);

create index if not exists products_owner_available_idx
  on public.products (owner_id)
  where status in ('in_stock', 'reserved', 'packing') and stock > 0;

drop policy if exists "employees read products" on public.products;
drop policy if exists "owners or admins read products" on public.products;
create policy "owners or admins read products"
on public.products for select to authenticated
using (
  owner_id = (select auth.uid())
  or (select public.my_role()) = 'admin'
);

drop policy if exists "employees create products" on public.products;
drop policy if exists "owners create products" on public.products;
create policy "owners create products"
on public.products for insert to authenticated
with check (
  owner_id = (select auth.uid())
  and (select public.my_role()) in ('admin', 'staff')
);

drop policy if exists "employees update products" on public.products;
drop policy if exists "owners or admins update products" on public.products;
create policy "owners or admins update products"
on public.products for update to authenticated
using (
  owner_id = (select auth.uid())
  or (select public.my_role()) = 'admin'
)
with check (
  owner_id = (select auth.uid())
  or (select public.my_role()) = 'admin'
);

-- QR labels inherit access from their parent product.
drop policy if exists "employees read qr labels" on public.product_qr_labels;
drop policy if exists "product owners or admins read qr labels" on public.product_qr_labels;
create policy "product owners or admins read qr labels"
on public.product_qr_labels for select to authenticated
using (
  exists (
    select 1
    from public.products p
    where p.id = product_qr_labels.product_id
      and (
        p.owner_id = (select auth.uid())
        or (select public.my_role()) = 'admin'
      )
  )
);

drop policy if exists "employees create qr labels" on public.product_qr_labels;
drop policy if exists "product owners or admins create qr labels" on public.product_qr_labels;
create policy "product owners or admins create qr labels"
on public.product_qr_labels for insert to authenticated
with check (
  exists (
    select 1
    from public.products p
    where p.id = product_qr_labels.product_id
      and (
        p.owner_id = (select auth.uid())
        or (select public.my_role()) = 'admin'
      )
  )
);

drop policy if exists "employees update qr labels" on public.product_qr_labels;
drop policy if exists "product owners or admins update qr labels" on public.product_qr_labels;
create policy "product owners or admins update qr labels"
on public.product_qr_labels for update to authenticated
using (
  exists (
    select 1
    from public.products p
    where p.id = product_qr_labels.product_id
      and (
        p.owner_id = (select auth.uid())
        or (select public.my_role()) = 'admin'
      )
  )
)
with check (
  exists (
    select 1
    from public.products p
    where p.id = product_qr_labels.product_id
      and (
        p.owner_id = (select auth.uid())
        or (select public.my_role()) = 'admin'
      )
  )
);

-- A public QR page may only recommend inventory belonging to the owner of the
-- scanned product. The function exposes only the existing public projection.
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
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'sku', recommendation.sku,
            'name', recommendation.name,
            'image_path', recommendation.image_path
          )
          order by recommendation.random_order
        )
        from (
          select
            product.sku,
            product.name,
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
