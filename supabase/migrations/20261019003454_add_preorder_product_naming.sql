begin;

-- NULL keeps legacy products unchanged; an empty string is a named single item.
alter table public.products add column preorder_item_name text
  constraint products_preorder_item_name_length check (char_length(preorder_item_name) <= 200);

create function public.format_preorder_product_name(p_country text, p_work text, p_item_name text)
returns text language plpgsql immutable security invoker set search_path = '' as $$
declare
  v_flag text;
  v_work text := btrim(regexp_replace(btrim(coalesce(p_work,'')), '^([🇦-🇿]{2}[[:space:]]*)+', ''));
  v_item text := btrim(regexp_replace(btrim(coalesce(p_item_name,'')), '^([🇦-🇿]{2}[[:space:]]*)+', ''));
  v_name text;
begin
  v_flag := case btrim(p_country)
    when '韓國' then '🇰🇷' when '日本' then '🇯🇵' when '台灣' then '🇹🇼'
    when '香港' then '🇭🇰' when '大陸' then '🇨🇳' else null end;
  if v_flag is null then raise exception '請選擇國家版本'; end if;
  if v_work = '' or char_length(v_work) > 200 or char_length(v_item) > 200 then
    raise exception '請填寫作品名稱，作品與品項名稱各限 200 字元';
  end if;
  v_name := v_flag || ' ' || v_work || case when v_item = '' then '' else ' ' || v_item end;
  if char_length(v_name) > 300 then raise exception '組合後的商品名稱最多 300 字元'; end if;
  return v_name;
end;
$$;
revoke all on function public.format_preorder_product_name(text,text,text) from public, anon;
grant execute on function public.format_preorder_product_name(text,text,text) to authenticated, service_role;

-- The wrapper keeps product creation, naming metadata, stock/QR adjustments and
-- future listing names in one transaction, under the existing inventory RLS.
create function public.save_named_inventory_product(
  p_input jsonb, p_owner_id uuid default null, p_product_id uuid default null
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid;
  v_owner uuid;
  v_work text := btrim(regexp_replace(btrim(coalesce(p_input->>'work','')), '^([🇦-🇿]{2}[[:space:]]*)+', ''));
  v_item text := btrim(regexp_replace(btrim(coalesce(p_input->>'preorderItemName','')), '^([🇦-🇿]{2}[[:space:]]*)+', ''));
  v_name text;
  v_images text[];
  v_crafts text[];
begin
  if (select auth.uid()) is null or (select public.my_role()) is null
    or (select public.my_role()) not in ('admin','staff') then
    raise exception 'employee access required';
  end if;
  if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'invalid product data'; end if;
  if p_product_id is null then
    v_owner := p_owner_id;
    if (p_input->>'stock')::integer is distinct from 0 then raise exception '預購商品庫存必須為 0'; end if;
  else
    select owner_id into v_owner from public.products where id=p_product_id for update;
    if not found then raise exception 'product not found'; end if;
    if p_owner_id is not null and p_owner_id is distinct from v_owner then raise exception 'owner access required'; end if;
  end if;
  if v_owner is null or ((select public.my_role()) <> 'admin'
    and v_owner is distinct from (select private.current_inventory_owner_id())) then
    raise exception 'owner access required';
  end if;
  v_name := public.format_preorder_product_name(p_input->>'country',v_work,v_item);
  if jsonb_typeof(p_input->'imagePaths') = 'array' then
    v_images := array(select jsonb_array_elements_text(p_input->'imagePaths'));
  end if;
  if jsonb_typeof(p_input->'crafts') = 'array' then
    v_crafts := array(select jsonb_array_elements_text(p_input->'crafts'));
  end if;
  if p_product_id is null then
    v_id := public.create_inventory_product(
      p_name=>v_name,p_work=>v_work,p_category=>p_input->>'category',
      p_country=>p_input->>'country',p_source=>p_input->>'source',
      p_location=>p_input->>'location',p_stock=>0,p_price=>(p_input->>'price')::numeric,
      p_cost=>0,p_image_paths=>v_images,p_poster_format=>p_input->>'format',
      p_poster_size=>p_input->>'size',p_poster_crafts=>v_crafts,
      p_identifying_features=>p_input->>'feature',p_owner_id=>v_owner,
      p_description=>p_input->>'description'
    );
  else
    if not public.update_inventory_product(
      p_product_id=>p_product_id,p_name=>v_name,p_category=>p_input->>'category',
      p_country=>p_input->>'country',p_source=>p_input->>'source',
      p_location=>p_input->>'location',p_stock=>(p_input->>'stock')::integer,
      p_price=>(p_input->>'price')::numeric,p_cost=>null,
      p_poster_format=>p_input->>'format',p_poster_size=>p_input->>'size',
      p_identifying_features=>p_input->>'feature',p_work=>v_work,
      p_poster_crafts=>v_crafts,p_image_paths=>v_images,p_description=>p_input->>'description'
    ) then raise exception 'product not updated'; end if;
    v_id := p_product_id;
  end if;
  update public.products set preorder_item_name=v_item where id=v_id;
  if not found then raise exception 'product not updated'; end if;
  return v_id;
end;
$$;
revoke all on function public.save_named_inventory_product(jsonb,uuid,uuid) from public, anon;
grant execute on function public.save_named_inventory_product(jsonb,uuid,uuid) to authenticated;

create function private.enforce_preorder_product_name()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_work text;
begin
  if new.preorder_item_name is not null then
    select title_zh into v_work from public.works where id=new.work_id;
    new.name := public.format_preorder_product_name(new.country,v_work,new.preorder_item_name);
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_preorder_product_name() from public, anon;
create trigger enforce_preorder_product_name before insert or update of name,country,work_id,preorder_item_name
on public.products for each row execute function private.enforce_preorder_product_name();

create function private.sync_preorder_listing_names()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  update public.claim_form_products set display_name=new.name where product_id=new.id and display_name is distinct from new.name;
  return new;
end;
$$;
revoke all on function private.sync_preorder_listing_names() from public, anon;
create trigger sync_preorder_listing_names after update of name,country,work_id,preorder_item_name
on public.products for each row when (new.preorder_item_name is not null and new.name is distinct from old.name)
execute function private.sync_preorder_listing_names();

create function private.enforce_preorder_listing_name()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_name text;
begin
  select name into v_name from public.products where id=new.product_id and preorder_item_name is not null;
  if found then new.display_name := v_name; end if;
  return new;
end;
$$;
revoke all on function private.enforce_preorder_listing_name() from public, anon;
create trigger enforce_preorder_listing_name before insert or update of display_name,product_id
on public.claim_form_products for each row execute function private.enforce_preorder_listing_name();

notify pgrst, 'reload schema';
commit;
