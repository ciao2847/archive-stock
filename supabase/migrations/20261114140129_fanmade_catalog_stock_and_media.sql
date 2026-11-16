begin;

alter table public.products add column if not exists inventory_kind text not null default 'standard'
  check (inventory_kind in ('standard','fanmade'));
create index if not exists products_owner_work_page_idx on public.products(owner_id,work_id,id);
create index if not exists order_items_product_reservations_idx on public.order_items(product_id,order_id);
create index if not exists products_kind_owner_idx on public.products(owner_id,inventory_kind);
create table public.fanmade_settings (
  owner_id uuid primary key references public.inventory_databases(id) on delete cascade,
  unit_price numeric(12,2) not null check(unit_price>=0), updated_at timestamptz not null default now()
);
create table public.fanmade_details (
  product_id uuid primary key references public.products(id) on delete cascade,
  owner_id uuid not null references public.inventory_databases(id) on delete cascade,
  title text not null check(length(btrim(title)) between 1 and 200),
  craft text not null check(length(btrim(craft)) between 1 and 100),
  is_active boolean not null default true, video_job_id uuid,
  updated_at timestamptz not null default now()
);
create index fanmade_details_owner_idx on public.fanmade_details(owner_id,craft,product_id);
create table public.fanmade_forms (
  form_id bigint primary key references public.claim_forms(id) on delete cascade,
  owner_id uuid not null references public.inventory_databases(id) on delete cascade
);
create index fanmade_forms_owner_idx on public.fanmade_forms(owner_id);
create table public.fanmade_stock_movements (
  id bigint generated always as identity primary key,
  product_id uuid references public.products(id) on delete set null,
  owner_id uuid not null references public.inventory_databases(id) on delete cascade,
  delta integer not null, balance integer not null check(balance>=0),
  reason text not null, actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index fanmade_movements_product_idx on public.fanmade_stock_movements(product_id,created_at desc);
create index fanmade_movements_owner_idx on public.fanmade_stock_movements(owner_id);
create table private.fanmade_batches (
  id uuid primary key, owner_id uuid not null references public.inventory_databases(id),
  payload jsonb not null, product_ids uuid[] not null, created_at timestamptz not null default now()
);
create index fanmade_batches_owner_idx on private.fanmade_batches(owner_id);
create table private.fanmade_video_jobs (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  owner_id uuid not null references public.inventory_databases(id) on delete cascade,
  source_path text not null, status text not null default 'pending' check(status in ('pending','processing','ready','failed')),
  attempts integer not null default 0, lease_token uuid, lease_until timestamptz,
  error text, duration numeric, output_bytes bigint,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check(source_path like owner_id::text || '/%')
);
create index fanmade_jobs_queue_idx on private.fanmade_video_jobs(status,lease_until,created_at);
create index fanmade_jobs_product_idx on private.fanmade_video_jobs(product_id);
create index fanmade_jobs_owner_idx on private.fanmade_video_jobs(owner_id);
alter table public.fanmade_details add constraint fanmade_details_video_fk foreign key(video_job_id)
 references private.fanmade_video_jobs(id) on delete set null;

-- RLS scopes rows; these guards also scope every referenced parent and video.
create function private.guard_fanmade_parent() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='fanmade_forms' then
   if not exists(select 1 from public.claim_forms where id=new.form_id and owner_id=new.owner_id) then raise exception 'form owner mismatch'; end if;
 else
   if not exists(select 1 from public.products where id=new.product_id and owner_id=new.owner_id) then raise exception 'product owner mismatch'; end if;
   if new.video_job_id is not null and not exists(select 1 from private.fanmade_video_jobs where id=new.video_job_id and product_id=new.product_id and owner_id=new.owner_id) then raise exception 'video product mismatch'; end if;
 end if;
 return new;
end $$;
create trigger fanmade_detail_parent before insert or update on public.fanmade_details for each row execute function private.guard_fanmade_parent();
create trigger fanmade_form_parent before insert or update on public.fanmade_forms for each row execute function private.guard_fanmade_parent();
revoke all on function private.guard_fanmade_parent() from public,anon,authenticated;

do $$ declare t text; begin
  foreach t in array array['fanmade_settings','fanmade_details','fanmade_forms','fanmade_stock_movements'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('create policy own_inventory on public.%I for select to authenticated using (owner_id=(select private.current_inventory_owner_id()) or (select public.my_role())=''admin'')',t);
  end loop;
  foreach t in array array['fanmade_settings','fanmade_details','fanmade_forms'] loop
    execute format('grant insert,update on public.%I to authenticated',t);
    execute format('create policy inventory_write on public.%I for all to authenticated using ((select public.my_role()) in (''admin'',''staff'') and (owner_id=(select private.current_inventory_owner_id()) or (select public.my_role())=''admin'')) with check ((select public.my_role()) in (''admin'',''staff'') and (owner_id=(select private.current_inventory_owner_id()) or (select public.my_role())=''admin''))',t);
  end loop;
end $$;
alter table private.fanmade_batches enable row level security;
alter table private.fanmade_video_jobs enable row level security;
revoke all on private.fanmade_batches,private.fanmade_video_jobs from public,anon,authenticated;
grant select,insert on private.fanmade_batches,private.fanmade_video_jobs to authenticated;
create policy own_batch on private.fanmade_batches to authenticated
 using(owner_id=(select private.current_inventory_owner_id()) or (select public.my_role())='admin')
 with check((select public.my_role()) in ('admin','staff') and (owner_id=(select private.current_inventory_owner_id()) or (select public.my_role())='admin'));
create policy own_job_read on private.fanmade_video_jobs for select to authenticated
 using(owner_id=(select private.current_inventory_owner_id()) or (select public.my_role())='admin');
create policy own_job_insert on private.fanmade_video_jobs for insert to authenticated
 with check(status='pending' and attempts=0 and lease_token is null and lease_until is null and error is null
 and (select public.my_role()) in ('admin','staff') and (owner_id=(select private.current_inventory_owner_id()) or (select public.my_role())='admin')
 and exists(select 1 from public.fanmade_details d where d.product_id=private.fanmade_video_jobs.product_id and d.owner_id=private.fanmade_video_jobs.owner_id));

-- One physical stock balance; outstanding order quantities are reservations.
create function private.fanmade_reserved(p_id uuid,p_exclude uuid default null)
returns integer language sql stable security definer set search_path='' as $$
 select coalesce(sum(greatest(i.quantity-i.packed_quantity,0)),0)::integer
 from public.order_items i join public.orders o on o.id=i.order_id
 where i.product_id=p_id and i.id is distinct from p_exclude and o.deleted_at is null
   and o.status in ('pending','packing');
$$;
revoke all on function private.fanmade_reserved(uuid,uuid) from public,anon;
grant execute on function private.fanmade_reserved(uuid,uuid) to authenticated;
create function private.guard_fanmade_order_item() returns trigger language plpgsql security definer set search_path='' as $$
declare p record; active_order boolean; v_exclude uuid:=new.id; begin
 select deleted_at is null and status in ('pending','packing') into active_order from public.orders where id=new.order_id;
 if not coalesce(active_order,false) then return new; end if;
 select id,stock into p from public.products where id=new.product_id and inventory_kind='fanmade' for update;
 if not found then return new; end if;
 -- The existing claim projection uses INSERT ... ON CONFLICT DO UPDATE.
 -- Its BEFORE INSERT fires even for an existing line; exclude that line once.
 if tg_op='INSERT' then
   select id into v_exclude from public.order_items where order_id=new.order_id and product_id=new.product_id;
 end if;
 if p.stock < private.fanmade_reserved(p.id,v_exclude)+greatest(new.quantity-new.packed_quantity,0) then
   raise exception using errcode='P0001',message='飯製商品庫存不足，請重新整理數量';
 end if;
 return new;
end $$;
create trigger fanmade_reserve_guard before insert or update of product_id,quantity,packed_quantity,order_id
 on public.order_items for each row execute function private.guard_fanmade_order_item();
create function private.check_fanmade_balance() returns trigger language plpgsql security definer set search_path='' as $$
declare p record; begin
 for p in select id,stock from public.products where inventory_kind='fanmade'
   and ((tg_table_name='products' and id=new.id) or (tg_table_name='orders' and id in(select product_id from public.order_items where order_id=new.id)))
   order by id for update loop
   if p.stock < private.fanmade_reserved(p.id) then raise exception '實際庫存不可低於已預留數量'; end if;
 end loop;
 return new;
end $$;
create constraint trigger fanmade_stock_check after insert or update on public.products
 deferrable initially deferred for each row execute function private.check_fanmade_balance();
create constraint trigger fanmade_order_check after update on public.orders
 deferrable initially deferred for each row execute function private.check_fanmade_balance();
create function private.log_fanmade_stock() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.inventory_kind='fanmade' and (new.stock is distinct from old.stock or old.inventory_kind is distinct from new.inventory_kind) then
   insert into public.fanmade_stock_movements(product_id,owner_id,delta,balance,reason,actor_id)
   values(new.id,new.owner_id,new.stock-case when old.inventory_kind='fanmade' then old.stock else 0 end,new.stock,
     coalesce(nullif(current_setting('app.fanmade_stock_reason',true),''),'庫存／出貨異動'),(select auth.uid()));
 end if;
 return new;
end $$;
create trigger fanmade_stock_log after update on public.products for each row execute function private.log_fanmade_stock();
revoke all on function private.guard_fanmade_order_item(),private.check_fanmade_balance(),private.log_fanmade_stock() from public,anon,authenticated;

-- Originals remain private. Only completed web playback files are public.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('fanmade-video-originals','fanmade-video-originals',false,104857600,array['video/mp4','video/quicktime','video/webm']),
 ('fanmade-video-playback','fanmade-video-playback',true,52428800,array['video/mp4','image/webp'])
on conflict(id) do nothing;
create policy fanmade_original_upload on storage.objects for insert to authenticated with check(
 bucket_id='fanmade-video-originals' and (select public.my_role()) in ('admin','staff')
 and (split_part(name,'/',1)=(select private.current_inventory_owner_id())::text or (select public.my_role())='admin'));
create policy fanmade_original_read on storage.objects for select to authenticated using(
 bucket_id='fanmade-video-originals' and split_part(name,'/',1)=(select private.current_inventory_owner_id())::text);

create function public.manage_fanmade(p_owner_id uuid,p_action text,p_input jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_price numeric; v_form bigint; v_id uuid; v_work uuid; v_item jsonb; v_ids uuid[]:='{}'; v_paths text[];
 v_batch uuid; v_payload jsonb; v_receipt private.fanmade_batches%rowtype; v_job uuid; v_row record;
 v_page integer:=greatest(1,least(coalesce((p_input->>'page')::integer,1),10000)); v_query text:=left(coalesce(p_input->>'query',''),100);
begin
 if (select auth.uid()) is null or coalesce((select public.my_role())::text,'') not in ('admin','staff') then raise exception 'employee access required'; end if;
 if p_owner_id is null or ((select public.my_role())<>'admin' and p_owner_id is distinct from (select private.current_inventory_owner_id())) then raise exception 'owner access required'; end if;
 if p_action='list' then
   select unit_price into v_price from public.fanmade_settings where owner_id=p_owner_id;
 else
   select unit_price into v_price from public.fanmade_settings where owner_id=p_owner_id for update;
 end if;
 if p_action='list' then
   return jsonb_build_object('price',v_price,'forms',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'title',f.title,'token',f.public_token,'isOpen',f.is_open) order by f.id) from public.claim_forms f join public.fanmade_forms ff on ff.form_id=f.id where ff.owner_id=p_owner_id),'[]'),
    'total',(select count(*) from public.fanmade_details d join public.products p on p.id=d.product_id left join public.works w on w.id=p.work_id where d.owner_id=p_owner_id and (v_query='' or position(lower(v_query) in lower(d.title||' '||d.craft||' '||coalesce(w.title_zh,'')))>0)),
    'products',coalesce((select jsonb_agg(x.item) from(select jsonb_build_object('id',p.id,'sku',p.sku,'title',d.title,'craft',d.craft,'ip',w.title_zh,'ipId',p.work_id,'stock',p.stock,'reserved',private.fanmade_reserved(p.id),'active',d.is_active,'imagePaths',p.image_paths,'updatedAt',p.updated_at,'videoStatus',j.status,'videoError',j.error,'listed',exists(select 1 from public.claim_form_products l where l.product_id=p.id and l.form_id=nullif(p_input->>'formId','')::bigint)) item
      from public.fanmade_details d join public.products p on p.id=d.product_id left join public.works w on w.id=p.work_id left join private.fanmade_video_jobs j on j.id=d.video_job_id
      where d.owner_id=p_owner_id and (v_query='' or position(lower(v_query) in lower(d.title||' '||d.craft||' '||coalesce(w.title_zh,'')))>0)
      order by p.created_at desc,p.id limit 24 offset (v_page-1)*24)x),'[]'),
    'legacy',coalesce((select jsonb_agg(x.item) from(select jsonb_build_object('id',p.id,'name',p.name,'stock',p.stock,'crafts',p.poster_crafts) item from public.products p where p.owner_id=p_owner_id and p.country='飯製' and p.inventory_kind='standard' order by p.created_at desc limit 100)x),'[]'));
 elsif p_action='price' then
   v_price:=(p_input->>'price')::numeric;
   if v_price is null or v_price<0 or v_price>9999999999.99 or v_price<>round(v_price,2) then raise exception '請填寫有效統一價格'; end if;
   insert into public.fanmade_settings(owner_id,unit_price) values(p_owner_id,v_price) on conflict(owner_id) do update set unit_price=excluded.unit_price,updated_at=now();
   return jsonb_build_object('saved',true);
 elsif p_action='create_form' then
   if v_price is null then raise exception '請先設定飯製統一售價'; end if;
   insert into public.claim_forms(owner_id,title,is_open,created_by) values(p_owner_id,btrim(p_input->>'title'),false,(select auth.uid())) returning id into v_form;
   insert into public.fanmade_forms values(v_form,p_owner_id);
   return jsonb_build_object('formId',v_form);
 elsif p_action='form' then
   v_form:=(p_input->>'formId')::bigint;
   if not exists(select 1 from public.fanmade_forms where form_id=v_form and owner_id=p_owner_id) then raise exception 'form not found'; end if;
   update public.claim_forms set title=btrim(p_input->>'title'),is_open=(p_input->>'isOpen')::boolean,updated_at=now() where id=v_form;
   return jsonb_build_object('saved',true);
 elsif p_action='batch' then
   if v_price is null then raise exception '請先設定飯製統一售價'; end if;
   v_batch:=(p_input->>'requestId')::uuid; v_payload:=p_input->'items';
   if v_batch is null or jsonb_typeof(v_payload) is distinct from 'array' or jsonb_array_length(v_payload) not between 1 and 50 then raise exception '每批限 1 至 50 件商品'; end if;
   perform pg_advisory_xact_lock(hashtextextended('fanmade:'||v_batch::text,0));
   select * into v_receipt from private.fanmade_batches where id=v_batch;
   if found then
     if v_receipt.owner_id<>p_owner_id or v_receipt.payload is distinct from v_payload then raise exception using errcode='22023',message='批次資料不一致，請沿用原批次確認'; end if;
     return jsonb_build_object('productIds',v_receipt.product_ids,'versions',(select jsonb_object_agg(id,updated_at) from public.products where id=any(v_receipt.product_ids)));
   end if;
   for v_item in select value from jsonb_array_elements(v_payload) loop
     if length(btrim(coalesce(v_item->>'ip',''))) not between 1 and 200 or length(btrim(coalesce(v_item->>'title',''))) not between 1 and 200 or length(btrim(coalesce(v_item->>'craft',''))) not between 1 and 100
       or length('🎨 '||btrim(v_item->>'ip')||'／'||btrim(v_item->>'title')||'｜'||btrim(v_item->>'craft'))>300
       or jsonb_typeof(v_item->'stock') is distinct from 'number' or (v_item->>'stock')::numeric<>trunc((v_item->>'stock')::numeric) or (v_item->>'stock')::integer not between 0 and 1000 then raise exception '請確認 IP、商品名稱、工藝與整數庫存，完整名稱最多 300 字'; end if;
     v_paths:=array(select jsonb_array_elements_text(v_item->'imagePaths'));
     if cardinality(v_paths)<>2 or v_paths[1]!~'^[0-9a-f-]{36}/main\.webp$' or v_paths[2] is distinct from replace(v_paths[1],'/main.webp','/thumb.webp') then raise exception '請先上傳完整商品圖片'; end if;
     if (select count(*) from storage.objects where bucket_id='product-images' and name=any(v_paths) and owner_id=(select auth.uid())::text)<>2 then raise exception '圖片不存在或無權使用'; end if;
     v_id:=public.create_inventory_product(p_name=>'🎨 '||btrim(v_item->>'ip')||'／'||btrim(v_item->>'title')||'｜'||btrim(v_item->>'craft'),p_work=>btrim(v_item->>'ip'),p_category=>'海報',p_country=>'飯製',p_source=>'',p_location=>'',p_stock=>0,p_price=>v_price,p_cost=>0,p_image_paths=>v_paths,p_poster_format=>'',p_poster_size=>'',p_poster_crafts=>array[btrim(v_item->>'craft')],p_identifying_features=>'',p_owner_id=>p_owner_id,p_description=>'');
     insert into public.fanmade_details(product_id,owner_id,title,craft) values(v_id,p_owner_id,btrim(v_item->>'title'),btrim(v_item->>'craft'));
     perform set_config('app.fanmade_stock_reason','飯製批次入庫',true);
     update public.products set inventory_kind='fanmade',stock=(v_item->>'stock')::integer,status=case when (v_item->>'stock')::integer>0 then 'in_stock'::public.product_status else 'packed'::public.product_status end where id=v_id;
     v_ids:=array_append(v_ids,v_id);
   end loop;
   insert into private.fanmade_batches(id,owner_id,payload,product_ids) values(v_batch,p_owner_id,v_payload,v_ids);
   return jsonb_build_object('productIds',v_ids,'versions',(select jsonb_object_agg(id,updated_at) from public.products where id=any(v_ids)));
 elsif p_action in ('stock','active','video','retry_video','edit','migrate') then
   v_id:=(p_input->>'productId')::uuid;
   select p.* into v_row from public.products p where id=v_id and owner_id=p_owner_id for update;
   if not found then raise exception 'product not found'; end if;
   if p_action='migrate' then
     if v_row.inventory_kind<>'standard' or v_row.country<>'飯製' or length(btrim(coalesce(p_input->>'craft',''))) not between 1 and 100 or v_price is null then raise exception '請確認舊飯製商品、單一工藝及統一價格'; end if;
     insert into public.fanmade_details(product_id,owner_id,title,craft) values(v_id,p_owner_id,left(v_row.name,200),btrim(p_input->>'craft'));
     perform set_config('app.fanmade_stock_reason','舊飯製整筆轉入，保留數量',true);
     delete from public.claim_form_products where product_id=v_id and form_id not in(select form_id from public.fanmade_forms where owner_id=p_owner_id);
     update public.products set inventory_kind='fanmade',price=v_price,preorder_item_name=null,name=left(name,190)||'｜'||btrim(p_input->>'craft'),poster_crafts=array[btrim(p_input->>'craft')] where id=v_id;
   else
     if v_row.inventory_kind<>'fanmade' then raise exception 'not a fanmade product'; end if;
     if p_input->>'updatedAt' is not null and (p_input->>'updatedAt')::timestamptz is distinct from v_row.updated_at then raise exception using errcode='22023',message='商品已被更新，請重新載入'; end if;
     if p_action='stock' then
       if jsonb_typeof(p_input->'stock') is distinct from 'number' or (p_input->>'stock')::numeric<>trunc((p_input->>'stock')::numeric) or (p_input->>'stock')::integer not between 0 and 1000 or length(btrim(coalesce(p_input->>'reason','')))=0 then raise exception '請填整數庫存及調整原因'; end if;
       perform set_config('app.fanmade_stock_reason',left(p_input->>'reason',200),true);
       update public.products set stock=(p_input->>'stock')::integer,updated_at=now() where id=v_id;
     elsif p_action='active' then
       update public.fanmade_details set is_active=(p_input->>'active')::boolean,updated_at=now() where product_id=v_id;
       update public.claim_form_products set is_enabled=(p_input->>'active')::boolean where product_id=v_id;
       update public.products set updated_at=now() where id=v_id;
     elsif p_action='edit' then
       if length(btrim(coalesce(p_input->>'title',''))) not between 1 and 200 or length(btrim(coalesce(p_input->>'craft',''))) not between 1 and 100 then raise exception '請填商品名稱與工藝'; end if;
       select title_zh into v_query from public.works where id=v_row.work_id;
       if length('🎨 '||coalesce(v_query,'未分類')||'／'||btrim(p_input->>'title')||'｜'||btrim(p_input->>'craft'))>300 then raise exception 'IP、名稱及工藝合計最多 300 字'; end if;
       update public.fanmade_details set title=btrim(p_input->>'title'),craft=btrim(p_input->>'craft'),updated_at=now() where product_id=v_id;
       update public.products set name='🎨 '||coalesce(v_query,'未分類')||'／'||btrim(p_input->>'title')||'｜'||btrim(p_input->>'craft'),poster_crafts=array[btrim(p_input->>'craft')],updated_at=now() where id=v_id;
     elsif p_action='retry_video' then
       select to_jsonb(j.source_path) into v_item from private.fanmade_video_jobs j join public.fanmade_details d on d.video_job_id=j.id where d.product_id=v_id and j.status='failed';
       if not found then raise exception '沒有可重試的失敗影片'; end if;
       insert into private.fanmade_video_jobs(product_id,owner_id,source_path) values(v_id,p_owner_id,v_item#>>'{}') returning id into v_job;
       update public.fanmade_details set video_job_id=v_job,updated_at=now() where product_id=v_id;
       update public.products set updated_at=now() where id=v_id;
     elsif p_action='video' then
       if not exists(select 1 from storage.objects where bucket_id='fanmade-video-originals' and name=p_input->>'sourcePath' and split_part(name,'/',1)=p_owner_id::text and owner_id=(select auth.uid())::text) then raise exception '請先上傳自己的商品實拍影片'; end if;
       insert into private.fanmade_video_jobs(product_id,owner_id,source_path) values(v_id,p_owner_id,p_input->>'sourcePath') returning id into v_job;
       update public.fanmade_details set video_job_id=v_job,updated_at=now() where product_id=v_id;
       update public.products set updated_at=now() where id=v_id;
     end if;
   end if;
   return jsonb_build_object('saved',true);
 elsif p_action in ('publish','publish_ip') then
   v_form:=(p_input->>'formId')::bigint;
   if not exists(select 1 from public.fanmade_forms where form_id=v_form and owner_id=p_owner_id) then raise exception 'form not found'; end if;
   if p_action='publish_ip' then
     select coalesce(jsonb_agg(p.id),'[]') into v_payload from public.products p join public.fanmade_details d on d.product_id=p.id where p.work_id=(p_input->>'ipId')::uuid and p.owner_id=p_owner_id and d.is_active;
   else v_payload:=p_input->'productIds'; end if;
   if jsonb_array_length(v_payload) not between 1 and 1000 then raise exception '請選 1 至 1000 件商品'; end if;
   for v_id in select value::uuid from jsonb_array_elements_text(v_payload) loop
     if not exists(select 1 from public.fanmade_details where product_id=v_id and owner_id=p_owner_id and is_active) then raise exception '商品不屬於庫藏或已停用'; end if;
     if coalesce((p_input->>'remove')::boolean,false) then delete from public.claim_form_products where form_id=v_form and product_id=v_id;
     else insert into public.claim_form_products(form_id,product_id,display_name,unit_price,max_quantity_per_customer,is_enabled)
       select v_form,p.id,p.name,v_price,99,true from public.products p where p.id=v_id
       on conflict(form_id,product_id) do update set unit_price=excluded.unit_price,is_enabled=true;
     end if;
   end loop;
   return jsonb_build_object('saved',true);
 else raise exception 'unknown action'; end if;
end $$;
revoke all on function public.manage_fanmade(uuid,text,jsonb) from public,anon;
grant execute on function public.manage_fanmade(uuid,text,jsonb) to authenticated;

-- Token-scoped public DTOs contain no customer data or original video paths.
create function public.get_fanmade_header(p_token uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('title',f.title,'description',f.description,'isOpen',f.is_open and (f.closes_at is null or f.closes_at>now()),
 'price',s.unit_price,'storeName',coalesce(i.name,'庫藏飯製'),'officialLineId',i.official_line_id,'completionMessage',i.claim_completion_message,
 'bannerImagePath',i.claim_banner_image_path,'bannerPosition',jsonb_build_object('x',coalesce(i.claim_banner_position_x,50),'y',coalesce(i.claim_banner_position_y,50)),
 'theme',jsonb_build_object('primaryColor',coalesce(i.claim_theme_primary_color,'#5A87B1'),'backgroundColor',coalesce(i.claim_theme_background_color,'#F3F7FB'),'surfaceColor',coalesce(i.claim_theme_surface_color,'#FFFFFF'),'headerTextColor',coalesce(i.claim_theme_header_text_color,'#172433')),
 'groups',coalesce((select jsonb_agg(g.item order by g.label) from(select coalesce(w.title_zh,'未分類') label,jsonb_build_object('id',p.work_id,'name',coalesce(w.title_zh,'未分類'),'count',count(*)) item
 from public.claim_form_products l join public.products p on p.id=l.product_id join public.fanmade_details d on d.product_id=p.id
 left join public.works w on w.id=p.work_id where l.form_id=f.id and l.is_enabled and d.is_active and p.owner_id=f.owner_id
 group by p.work_id,w.title_zh)g),'[]'))
 from public.claim_forms f join public.fanmade_forms ff on ff.form_id=f.id and ff.owner_id=f.owner_id
 join public.fanmade_settings s on s.owner_id=f.owner_id join public.inventory_databases i on i.id=f.owner_id where f.public_token=p_token;
$$;
create function public.get_fanmade_page(p_token uuid,p_ip uuid,p_page integer default 1,p_query text default '') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_form bigint; v_owner uuid; v_total integer; v_items jsonb; begin
 select f.id,f.owner_id into v_form,v_owner from public.claim_forms f join public.fanmade_forms ff on ff.form_id=f.id where f.public_token=p_token;
 if not found then return null; end if;
 if p_page not between 1 and 10000 or length(p_query)>100 then raise exception 'invalid page'; end if;
 select count(*) into v_total from public.claim_form_products l join public.products p on p.id=l.product_id join public.fanmade_details d on d.product_id=p.id
 where l.form_id=v_form and p.owner_id=v_owner and p.work_id=p_ip and l.is_enabled and d.is_active and (p_query='' or position(lower(p_query) in lower(d.title||' '||d.craft))>0);
 select coalesce(jsonb_agg(x.item order by x.sort_order,x.id),'[]') into v_items from(
 select l.sort_order,p.id,jsonb_build_object('id',p.id,'sku',p.sku,'title',d.title,'name',d.title||'｜'||d.craft,'work',w.title_zh,'craft',d.craft,'category','飯製海報','price',l.unit_price,
 'available',greatest(0,p.stock-private.fanmade_reserved(p.id)),'maxQuantity',least(l.max_quantity_per_customer,greatest(0,p.stock-private.fanmade_reserved(p.id))),
 'thumbnailPath',coalesce(p.image_paths[2],p.image_paths[1]),'videoAvailable',j.status='ready',
 'posterPath',case when j.status='ready' then j.owner_id::text||'/'||j.product_id::text||'/'||j.id::text||'/'||j.lease_token::text||'/poster.webp' else null end) item
 from public.claim_form_products l join public.products p on p.id=l.product_id join public.fanmade_details d on d.product_id=p.id
 left join public.works w on w.id=p.work_id left join private.fanmade_video_jobs j on j.id=d.video_job_id
 where l.form_id=v_form and p.owner_id=v_owner and p.work_id=p_ip and l.is_enabled and d.is_active and (p_query='' or position(lower(p_query) in lower(d.title||' '||d.craft))>0)
 order by l.sort_order,p.id limit 12 offset (p_page-1)*12)x;
 return jsonb_build_object('products',v_items,'total',v_total,'page',p_page,'hasMore',p_page*12<v_total);
end $$;
create function public.get_fanmade_media(p_token uuid,p_product_id uuid,p_kind text) returns jsonb
language sql stable security definer set search_path='' as $$
 select case when p_kind='image' then jsonb_build_object('bucket','product-images','path',p.image_paths[1])
 when p_kind='video' and j.status='ready' then jsonb_build_object('bucket','fanmade-video-playback','path',j.owner_id::text||'/'||j.product_id::text||'/'||j.id::text||'/'||j.lease_token::text||'/video.mp4') else null end
 from public.claim_forms f join public.fanmade_forms ff on ff.form_id=f.id join public.claim_form_products l on l.form_id=f.id
 join public.products p on p.id=l.product_id and p.owner_id=f.owner_id join public.fanmade_details d on d.product_id=p.id
 left join private.fanmade_video_jobs j on j.id=d.video_job_id
 where f.public_token=p_token and p.id=p_product_id and l.is_enabled and d.is_active;
$$;
create function public.submit_fanmade_claim(p_token uuid,p_nickname text,p_phone text,p_notes text,p_request_id uuid,p_items jsonb,p_expected_price numeric default null)
returns table(confirmation_code text,submitted_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare v_price numeric;
begin
 -- A lost-response retry must still return its original receipt after a price change.
 if exists(select 1 from public.claim_submissions s join public.claim_forms f on f.id=s.form_id join public.fanmade_forms ff on ff.form_id=f.id where f.public_token=p_token and s.request_id=p_request_id) then
   return query select * from public.submit_public_claim(p_token,p_nickname,p_phone,p_notes,p_request_id,p_items);
   return;
 end if;
 select s.unit_price into v_price from public.fanmade_settings s join public.claim_forms f on f.owner_id=s.owner_id join public.fanmade_forms ff on ff.form_id=f.id where f.public_token=p_token for share of s;
 if p_expected_price is null or v_price is distinct from p_expected_price then raise exception '飯製統一價格已更新，請重新整理後確認'; end if;
 if not exists(select 1 from public.claim_forms f join public.fanmade_forms ff on ff.form_id=f.id where f.public_token=p_token) then raise exception 'claim form not found'; end if;
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 100 then raise exception 'invalid claim items'; end if;
 -- Lock all selected products in stable order before the existing claim projection creates order lines.
 perform 1 from public.products p where p.id in(select (x->>'product_id')::uuid from jsonb_array_elements(p_items)x) order by p.id for update;
 return query select * from public.submit_public_claim(p_token,p_nickname,p_phone,p_notes,p_request_id,p_items);
end $$;
revoke all on function public.get_fanmade_header(uuid),public.get_fanmade_page(uuid,uuid,integer,text),public.get_fanmade_media(uuid,uuid,text),public.submit_fanmade_claim(uuid,text,text,text,uuid,jsonb,numeric) from public;
grant execute on function public.get_fanmade_header(uuid),public.get_fanmade_page(uuid,uuid,integer,text),public.get_fanmade_media(uuid,uuid,text),public.submit_fanmade_claim(uuid,text,text,text,uuid,jsonb,numeric) to anon,authenticated;

create function public.claim_fanmade_video_job() returns jsonb
language plpgsql security definer set search_path='' as $$
declare j private.fanmade_video_jobs%rowtype; begin
 -- Permanently failed leases do not leave the queue stuck forever.
 update private.fanmade_video_jobs set status='failed',error='轉檔重試次數已用完',updated_at=now()
 where status='processing' and lease_until<now() and attempts>=3;
 select q.* into j from private.fanmade_video_jobs q join public.fanmade_details d on d.video_job_id=q.id
 where (q.status='pending' or (q.status='processing' and q.lease_until<now())) and q.attempts<3
 order by q.created_at for update of q skip locked limit 1;
 if not found then return null; end if;
 update private.fanmade_video_jobs set status='processing',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',updated_at=now() where id=j.id returning * into j;
 return jsonb_build_object('id',j.id,'productId',j.product_id,'ownerId',j.owner_id,'sourcePath',j.source_path,'leaseToken',j.lease_token);
end $$;
create function public.finish_fanmade_video_job(p_id uuid,p_lease uuid,p_error text default null,p_duration numeric default null,p_bytes bigint default null)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 update private.fanmade_video_jobs set status=case when p_error is null then 'ready' else 'failed' end,
 error=left(p_error,300),duration=p_duration,output_bytes=p_bytes,lease_until=null,updated_at=now()
 where id=p_id and lease_token=p_lease and status='processing' and lease_until>now()
 and exists(select 1 from public.fanmade_details where video_job_id=p_id);
 return found;
end $$;
revoke all on function public.claim_fanmade_video_job(),public.finish_fanmade_video_job(uuid,uuid,text,numeric,bigint) from public,anon,authenticated;
grant execute on function public.claim_fanmade_video_job(),public.finish_fanmade_video_job(uuid,uuid,text,numeric,bigint) to service_role;


create function private.guard_fanmade_product() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and old.inventory_kind='fanmade' and new.inventory_kind<>'fanmade' then raise exception '飯製商品請從專用管理維護'; end if;
 if new.inventory_kind='fanmade' then
   if not exists(select 1 from public.fanmade_details where product_id=new.id and owner_id=new.owner_id) then raise exception '飯製商品明細不完整'; end if;
   select unit_price into new.price from public.fanmade_settings where owner_id=new.owner_id;
   if new.price is null then raise exception '請先設定統一價格'; end if;
 end if; return new;
end $$;
create trigger fanmade_product_guard before insert or update on public.products for each row execute function private.guard_fanmade_product();
create function private.guard_fanmade_listing() returns trigger language plpgsql security definer set search_path='' as $$
declare p record; f_owner uuid; begin
 select inventory_kind,owner_id into p from public.products where id=new.product_id;
 select owner_id into f_owner from public.fanmade_forms where form_id=new.form_id;
 if p.inventory_kind='fanmade' then
   if f_owner is distinct from p.owner_id then raise exception '飯製商品請加入飯製專用表單'; end if;
   select unit_price into new.unit_price from public.fanmade_settings where owner_id=p.owner_id;
 elsif f_owner is not null then raise exception '飯製表單只可加入飯製商品'; end if;
 return new;
end $$;
create trigger fanmade_listing_guard before insert or update on public.claim_form_products for each row execute function private.guard_fanmade_listing();
revoke all on function private.guard_fanmade_product(),private.guard_fanmade_listing() from public,anon,authenticated;

create function private.apply_fanmade_price() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update public.products set price=new.unit_price,updated_at=now() where owner_id=new.owner_id and inventory_kind='fanmade';
 update public.claim_form_products set unit_price=new.unit_price where form_id in(select form_id from public.fanmade_forms where owner_id=new.owner_id);
 return new;
end $$;
create trigger fanmade_uniform_price after update of unit_price on public.fanmade_settings for each row when(old.unit_price is distinct from new.unit_price) execute function private.apply_fanmade_price();
revoke all on function private.apply_fanmade_price() from public,anon,authenticated;

notify pgrst,'reload schema';
commit;
