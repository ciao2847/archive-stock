begin;

do $$
begin
  if to_regprocedure('public.create_preorder_product_batch(uuid,uuid,jsonb)') is null
    or to_regclass('private.preorder_product_batches') is null then
    raise exception '請先套用 20261019020507_add_preorder_text_batches.sql，再執行整圖多款 migration';
  end if;
end;
$$;

-- Keep the existing SKU, procurement and packing model. All options refer to
-- one uploaded main/thumbnail pair; the public UI groups that exact image URL.
create or replace function public.create_shared_image_product_batch(
  p_owner_id uuid, p_batch_id uuid, p_items jsonb, p_image_paths text[]
) returns uuid[] language plpgsql security invoker set search_path = '' as $$
declare
  v_items jsonb;
  v_ids uuid[];
  v_existing boolean;
  v_path text;
  v_count integer;
begin
  if (select auth.uid()) is null or coalesce((select public.my_role())::text, '') not in ('admin','staff') then
    raise exception 'employee access required';
  end if;
  if p_owner_id is null or ((select public.my_role()) <> 'admin'
    and p_owner_id is distinct from (select private.current_inventory_owner_id())) then
    raise exception 'owner access required';
  end if;
  if p_batch_id is null or jsonb_typeof(p_items) is distinct from 'array' then raise exception '請確認款式資料'; end if;
  if jsonb_array_length(p_items) not between 2 and 50 then raise exception '請提供 2 至 50 個款式'; end if;
  if cardinality(p_image_paths) is distinct from 2
    or p_image_paths[1] is null or p_image_paths[2] is null
    or p_image_paths[1] !~ '^[0-9a-fA-F-]{36}/main\.webp$'
    or p_image_paths[2] is distinct from replace(p_image_paths[1], '/main.webp', '/thumb.webp') then
    raise exception '請提供同一張圖片的主圖與縮圖';
  end if;
  if exists(select 1 from jsonb_array_elements(p_items) item
    where (item - 'itemName' - 'price') is distinct from ((p_items->0) - 'itemName' - 'price')) then
    raise exception '共用圖片的款式須使用相同作品與規格';
  end if;
  -- Include immutable image identity in the existing retry receipt. A retry
  -- must not overwrite images subsequently changed by a staff member.
  select jsonb_agg(item || jsonb_build_object('sharedImagePaths', to_jsonb(p_image_paths)) order by position)
    into v_items from jsonb_array_elements(p_items) with ordinality as entry(item,position);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('preorder-batch:' || p_batch_id::text,0));
  select exists(select 1 from private.preorder_product_batches where id=p_batch_id) into v_existing;
  if not v_existing then
    foreach v_path in array p_image_paths loop
      perform 1 from storage.objects where bucket_id='product-images' and name=v_path
        and owner_id=(select auth.uid())::text for share;
      if not found then raise exception '圖片不存在或不屬於目前帳號，請重新上傳'; end if;
    end loop;
  end if;
  v_ids := public.create_preorder_product_batch(p_owner_id,p_batch_id,v_items);
  if not v_existing then
    update public.products set image_paths=p_image_paths where id=any(v_ids) and owner_id=p_owner_id;
    get diagnostics v_count = row_count;
    if v_count <> cardinality(v_ids) then raise exception '款式圖片儲存失敗'; end if;
  end if;
  return v_ids;
end;
$$;
revoke all on function public.create_shared_image_product_batch(uuid,uuid,jsonb,text[]) from public,anon;
grant execute on function public.create_shared_image_product_batch(uuid,uuid,jsonb,text[]) to authenticated;

create index if not exists products_image_paths_gin_idx on public.products using gin(image_paths);

-- Intentionally definer: the guard must see references in every inventory,
-- even when the caller's product RLS cannot see them. It exposes only a boolean
-- and cannot read image contents or write data. Existing storage ownership
-- policies still apply in addition to this restrictive policy.
create or replace function private.product_image_is_unreferenced(p_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists(select 1 from public.products where image_paths @> array[p_path]);
$$;
revoke all on function private.product_image_is_unreferenced(text) from public,anon;
grant execute on function private.product_image_is_unreferenced(text) to authenticated;
drop policy if exists product_images_keep_referenced on storage.objects;
create policy product_images_keep_referenced on storage.objects as restrictive for delete to authenticated
using (bucket_id <> 'product-images' or private.product_image_is_unreferenced(name));

notify pgrst, 'reload schema';
commit;
