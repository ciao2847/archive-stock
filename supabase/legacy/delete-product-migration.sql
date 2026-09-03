create index if not exists order_items_product_id_idx
  on public.order_items(product_id);

create index if not exists packing_scans_product_id_idx
  on public.packing_scans(product_id);

create index if not exists location_movements_product_id_idx
  on public.location_movements(product_id);

drop function if exists public.delete_inventory_product(uuid);

create function public.delete_inventory_product(p_product_id uuid)
returns text[]
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_image_paths text[];
begin
  if auth.uid() is null or public.my_role() <> 'admin' then
    raise exception 'admin access required';
  end if;

  select p.image_paths
  into v_image_paths
  from public.products p
  where p.id = p_product_id
  for update;

  if not found then
    raise exception 'product not found';
  end if;

  if exists (
    select 1
    from public.order_items oi
    where oi.product_id = p_product_id
  ) then
    raise exception 'product has order history';
  end if;

  if exists (
    select 1
    from public.packing_scans ps
    where ps.product_id = p_product_id
  ) then
    raise exception 'product has packing history';
  end if;

  if exists (
    select 1
    from public.settlement_products sp
    where sp.product_id = p_product_id
  ) then
    raise exception 'product has settlement history';
  end if;

  delete from public.location_movements
  where product_id = p_product_id;

  delete from public.products
  where id = p_product_id;

  return coalesce(v_image_paths, array[]::text[]);
end $$;

grant delete on public.products to authenticated;
revoke execute on function public.delete_inventory_product(uuid) from public, anon;
grant execute on function public.delete_inventory_product(uuid) to authenticated;

notify pgrst, 'reload schema';

select
  to_regprocedure('public.delete_inventory_product(uuid)') is not null
  and has_function_privilege(
    'authenticated',
    'public.delete_inventory_product(uuid)',
    'execute'
  ) as delete_inventory_product_ready;
