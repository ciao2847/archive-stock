begin;

-- Kept outside the Data API. Immutable receipts make a lost HTTP response safe
-- to retry without creating another set of products.
create table private.preorder_product_batches (
  id uuid primary key,
  owner_id uuid not null references public.inventory_databases(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 50),
  product_ids uuid[] not null check (cardinality(product_ids) = jsonb_array_length(items)),
  created_at timestamptz not null default now()
);
create index preorder_product_batches_owner_id_idx on private.preorder_product_batches(owner_id);
create index preorder_product_batches_created_by_idx on private.preorder_product_batches(created_by);
alter table private.preorder_product_batches enable row level security;
revoke all on private.preorder_product_batches from public, anon, authenticated;
grant select, insert on private.preorder_product_batches to authenticated;
create policy preorder_batch_read on private.preorder_product_batches for select to authenticated
  using ((select public.my_role()) = 'admin' or owner_id = (select private.current_inventory_owner_id()));
create policy preorder_batch_create on private.preorder_product_batches for insert to authenticated
  with check (created_by = (select auth.uid()) and (select public.my_role()) in ('admin','staff')
    and ((select public.my_role()) = 'admin' or owner_id = (select private.current_inventory_owner_id())));

create function public.create_preorder_product_batch(p_owner_id uuid,p_batch_id uuid,p_items jsonb)
returns uuid[] language plpgsql security invoker set search_path = '' as $$
declare
  v_receipt private.preorder_product_batches%rowtype;
  v_item jsonb;
  v_input jsonb;
  v_ids uuid[] := '{}';
  v_key jsonb;
  v_seen jsonb[] := '{}';
  v_price numeric;
  v_name text;
begin
  if (select auth.uid()) is null or (select public.my_role()) is null
    or (select public.my_role()) not in ('admin','staff') then raise exception 'employee access required'; end if;
  if p_owner_id is null or ((select public.my_role()) <> 'admin'
    and p_owner_id is distinct from (select private.current_inventory_owner_id())) then raise exception 'owner access required'; end if;
  if p_batch_id is null or jsonb_typeof(p_items) is distinct from 'array' then raise exception '請確認批次資料'; end if;
  if jsonb_array_length(p_items) not between 1 and 50 then raise exception '每批須有 1 至 50 項商品'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('preorder-batch:' || p_batch_id::text,0));
  select * into v_receipt from private.preorder_product_batches where id = p_batch_id;
  if found then
    if v_receipt.owner_id is distinct from p_owner_id or v_receipt.items is distinct from p_items then
      raise exception using errcode='22023',message='同一批次的資料不一致，請重新整理後確認';
    end if;
    return v_receipt.product_ids;
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) is distinct from 'object'
      or jsonb_typeof(v_item->'work') is distinct from 'string'
      or jsonb_typeof(v_item->'country') is distinct from 'string'
      or jsonb_typeof(v_item->'itemName') is distinct from 'string'
      or jsonb_typeof(v_item->'size') is distinct from 'string'
      or jsonb_typeof(v_item->'format') is distinct from 'string'
      or jsonb_typeof(v_item->'price') is distinct from 'number' then raise exception '請確認商品欄位'; end if;
    if btrim(v_item->>'work') = '' or char_length(v_item->>'work') > 200
      or char_length(v_item->>'itemName') > 200
      or char_length(v_item->>'size') > 100 or char_length(v_item->>'format') > 100
      or (jsonb_array_length(p_items) > 1 and btrim(v_item->>'itemName') = '') then raise exception '請確認作品與品項名稱'; end if;
    v_name := public.format_preorder_product_name(v_item->>'country',v_item->>'work',v_item->>'itemName');
    v_price := (v_item->>'price')::numeric;
    if v_price < 0 or v_price > 9999999999.99 or v_price <> round(v_price,2) then raise exception '請填寫有效的 NT$ 售價，最多兩位小數'; end if;
    if v_item->>'format' not in ('','一般版','IMAX','Dolby Cinema','4DX','SCREENX','MX4D','2D','3D','其他特殊版本','特別場') then raise exception '請選擇有效版本'; end if;
    v_key := jsonb_build_array(v_name,btrim(v_item->>'size'),btrim(v_item->>'format'));
    if v_key = any(v_seen) then raise exception '同一批有重複的商品與規格'; end if;
    v_seen := array_append(v_seen,v_key);
    -- Build an allowlisted input, ignoring any client stock, QR or image fields.
    v_input := jsonb_build_object('work',v_item->>'work','country',v_item->>'country',
      'preorderItemName',v_item->>'itemName','price',v_price,'size',btrim(v_item->>'size'),
      'format',btrim(v_item->>'format'),'category','海報','source','','location','',
      'stock',0,'crafts','[]'::jsonb,'imagePaths','[]'::jsonb,'feature','','description','');
    v_ids := array_append(v_ids,public.save_named_inventory_product(v_input,p_owner_id));
  end loop;
  insert into private.preorder_product_batches(id,owner_id,created_by,items,product_ids)
    values(p_batch_id,p_owner_id,(select auth.uid()),p_items,v_ids);
  return v_ids;
end;
$$;
revoke all on function public.create_preorder_product_batch(uuid,uuid,jsonb) from public, anon;
grant execute on function public.create_preorder_product_batch(uuid,uuid,jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
