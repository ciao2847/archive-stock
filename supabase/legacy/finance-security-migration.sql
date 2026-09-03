create or replace function public.get_admin_product_costs()
returns table(product_id uuid, cost numeric)
language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null or public.my_role()<>'admin' then raise exception 'admin access required'; end if;
  return query select p.id,coalesce(p.cost,0) from public.products p;
end $$;

revoke execute on function public.get_admin_product_costs() from public, anon;
grant execute on function public.get_admin_product_costs() to authenticated;

revoke select, insert, update on public.products from authenticated;
grant select (id,sku,name,category,work_id,country,source,location_id,stock,status,price,notes,image_paths,poster_format,poster_crafts,poster_size,style_name,edition,is_art_set,release_date,cinema,identifying_features,created_by,created_at,updated_at) on public.products to authenticated;
grant insert (name,category,work_id,country,source,location_id,stock,status,price,notes,image_paths,poster_format,poster_crafts,poster_size,style_name,edition,is_art_set,release_date,cinema,identifying_features,created_by,updated_at) on public.products to authenticated;
grant update (name,category,work_id,country,source,location_id,stock,status,price,notes,image_paths,poster_format,poster_crafts,poster_size,style_name,edition,is_art_set,release_date,cinema,identifying_features,updated_at) on public.products to authenticated;
