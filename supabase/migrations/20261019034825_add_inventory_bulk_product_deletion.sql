begin;

-- Validate and lock the entire set before deleting anything. Reuse the single
-- product deletion rules, including transaction history and QR cleanup.
create function public.delete_inventory_products(p_product_ids uuid[])
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid;
  v_ids uuid[] := '{}';
  v_images text[] := '{}';
begin
  if (select auth.uid()) is null or coalesce((select public.my_role())::text,'') not in ('admin','staff') then
    raise exception 'inventory access required';
  end if;
  if coalesce(cardinality(p_product_ids),0) not between 1 and 50
    or array_ndims(p_product_ids) is distinct from 1
    or (select count(distinct id) from unnest(p_product_ids) as ids(id)) <> cardinality(p_product_ids) then
    raise exception using errcode='22023',message='每批請選擇 1 至 50 項不重複的商品';
  end if;
  for v_id in
    select p.id from public.products p where p.id=any(p_product_ids)
      and ((select public.my_role())='admin' or p.owner_id=(select private.current_inventory_owner_id()))
    order by p.id for update
  loop
    v_ids := array_append(v_ids,v_id);
  end loop;
  if cardinality(v_ids) <> cardinality(p_product_ids) then raise exception 'product not found'; end if;
  foreach v_id in array v_ids loop
    v_images := v_images || public.delete_inventory_product(v_id);
  end loop;
  if exists(select 1 from public.products where id=any(v_ids)) then raise exception 'products not deleted'; end if;
  return jsonb_build_object('deletedProductIds',v_ids,'imagePaths',
    array(select distinct path from unnest(v_images) paths(path) where path is not null));
end;
$$;
revoke all on function public.delete_inventory_products(uuid[]) from public, anon;
grant execute on function public.delete_inventory_products(uuid[]) to authenticated;
notify pgrst, 'reload schema';
commit;
