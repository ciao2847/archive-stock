begin;

-- A catalog group only joins the presentation. Every craft keeps its original SKU,
-- physical stock, reservations, video and historical order references.
alter table public.fanmade_details add column catalog_group_id uuid;

create function private.fanmade_catalog_group(p_product_id uuid,p_owner_id uuid,p_title text)
returns uuid language plpgsql stable security definer set search_path='' as $$
declare v_work uuid; v_image text; v_owner uuid;
begin
  select owner_id,work_id,nullif(image_paths[1],'') into v_owner,v_work,v_image
  from public.products where id=p_product_id;
  if not found or v_owner is distinct from p_owner_id then raise exception 'product owner mismatch'; end if;
  -- An absent photo cannot establish that two legacy posters are the same design.
  if v_image is null then return p_product_id; end if;
  return md5(jsonb_build_array(p_owner_id,v_work,btrim(p_title),v_image)::text)::uuid;
end $$;
revoke all on function private.fanmade_catalog_group(uuid,uuid,text) from public,anon,authenticated;

update public.fanmade_details d set catalog_group_id=private.fanmade_catalog_group(d.product_id,d.owner_id,d.title);
alter table public.fanmade_details alter column catalog_group_id set not null;
create index fanmade_details_catalog_group_idx on public.fanmade_details(owner_id,catalog_group_id,product_id);

create function private.assign_fanmade_catalog_group() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  -- Never trust a caller-supplied group UUID to join unrelated designs.
  new.catalog_group_id:=private.fanmade_catalog_group(new.product_id,new.owner_id,new.title);
  return new;
end $$;
create trigger fanmade_catalog_group before insert or update on public.fanmade_details
for each row execute function private.assign_fanmade_catalog_group();

create function private.refresh_fanmade_catalog_group() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  update public.fanmade_details set catalog_group_id=private.fanmade_catalog_group(product_id,owner_id,title)
  where product_id=new.id;
  return new;
end $$;
create trigger fanmade_catalog_source after update of work_id,image_paths on public.products
for each row when(old.work_id is distinct from new.work_id or old.image_paths is distinct from new.image_paths)
execute function private.refresh_fanmade_catalog_group();
revoke all on function private.assign_fanmade_catalog_group(),private.refresh_fanmade_catalog_group() from public,anon,authenticated;

create or replace function public.get_fanmade_header(p_token uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('title',f.title,'description',f.description,'isOpen',f.is_open and (f.closes_at is null or f.closes_at>now()),
 'price',s.unit_price,'storeName',coalesce(i.name,'庫藏飯製'),'officialLineId',i.official_line_id,'completionMessage',i.claim_completion_message,
 'bannerImagePath',i.claim_banner_image_path,'bannerPosition',jsonb_build_object('x',coalesce(i.claim_banner_position_x,50),'y',coalesce(i.claim_banner_position_y,50)),
 'theme',jsonb_build_object('primaryColor',coalesce(i.claim_theme_primary_color,'#5A87B1'),'backgroundColor',coalesce(i.claim_theme_background_color,'#F3F7FB'),'surfaceColor',coalesce(i.claim_theme_surface_color,'#FFFFFF'),'headerTextColor',coalesce(i.claim_theme_header_text_color,'#172433')),
 'groups',coalesce((select jsonb_agg(g.item order by g.label) from(select coalesce(w.title_zh,'未分類') label,jsonb_build_object('id',p.work_id,'name',coalesce(w.title_zh,'未分類'),'count',count(distinct d.catalog_group_id),'variantCount',count(*)) item
 from public.claim_form_products l join public.products p on p.id=l.product_id join public.fanmade_details d on d.product_id=p.id
 left join public.works w on w.id=p.work_id where l.form_id=f.id and l.is_enabled and d.is_active and p.owner_id=f.owner_id
 group by p.work_id,w.title_zh)g),'[]'))
 from public.claim_forms f join public.fanmade_forms ff on ff.form_id=f.id and ff.owner_id=f.owner_id
 join public.fanmade_settings s on s.owner_id=f.owner_id join public.inventory_databases i on i.id=f.owner_id where f.public_token=p_token;
$$;

-- Page designs first, then include all of the selected designs' enabled crafts.
-- A page boundary can never split the two crafts of one poster.
create or replace function public.get_fanmade_page(p_token uuid,p_ip uuid,p_page integer default 1,p_query text default '') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_form bigint;v_owner uuid;v_total integer;v_items jsonb;
begin
  select f.id,f.owner_id into v_form,v_owner from public.claim_forms f
  join public.fanmade_forms ff on ff.form_id=f.id and ff.owner_id=f.owner_id where f.public_token=p_token;
  if not found then return null; end if;
  if p_page is null or p_page not between 1 and 10000 or p_query is null or length(p_query)>100 then raise exception 'invalid page'; end if;
  select count(distinct d.catalog_group_id) into v_total
  from public.claim_form_products l join public.products p on p.id=l.product_id join public.fanmade_details d on d.product_id=p.id
  where l.form_id=v_form and p.owner_id=v_owner and p.work_id=p_ip and l.is_enabled and d.is_active
    and (p_query='' or position(lower(p_query) in lower(d.title||' '||d.craft))>0);
  with matching as (
    select d.catalog_group_id,min(l.sort_order) sort_order
    from public.claim_form_products l join public.products p on p.id=l.product_id join public.fanmade_details d on d.product_id=p.id
    where l.form_id=v_form and p.owner_id=v_owner and p.work_id=p_ip and l.is_enabled and d.is_active
      and (p_query='' or position(lower(p_query) in lower(d.title||' '||d.craft))>0)
    group by d.catalog_group_id
  ), chosen as (
    select * from matching order by sort_order,catalog_group_id limit 12 offset (p_page-1)*12
  ), items as (
    select g.sort_order group_order,g.catalog_group_id,l.sort_order,d.craft,p.id,
      jsonb_build_object('id',p.id,'catalogGroupId',d.catalog_group_id,'sku',p.sku,'title',d.title,
        'name',d.title||'｜'||d.craft,'work',w.title_zh,'craft',d.craft,'category','飯製海報','price',l.unit_price,
        'available',greatest(0,p.stock-private.fanmade_reserved(p.id)),
        'maxQuantity',least(l.max_quantity_per_customer,greatest(0,p.stock-private.fanmade_reserved(p.id))),
        'thumbnailPath',coalesce(p.image_paths[2],p.image_paths[1]),'videoAvailable',j.status='ready',
        'posterPath',case when j.status='ready' then j.owner_id::text||'/'||j.product_id::text||'/'||j.id::text||'/'||j.lease_token::text||'/poster.webp' else null end) item
    from chosen g join public.fanmade_details d on d.catalog_group_id=g.catalog_group_id and d.owner_id=v_owner
    join public.products p on p.id=d.product_id and p.owner_id=v_owner and p.work_id=p_ip
    join public.claim_form_products l on l.product_id=p.id and l.form_id=v_form
    left join public.works w on w.id=p.work_id left join private.fanmade_video_jobs j on j.id=d.video_job_id
    where l.is_enabled and d.is_active
  ) select coalesce(jsonb_agg(item order by group_order,catalog_group_id,sort_order,craft,id),'[]') into v_items from items;
  return jsonb_build_object('products',v_items,'total',v_total,'page',p_page,'hasMore',p_page*12<v_total);
end $$;

-- Keep the existing action gateway intact. Management now pages complete groups.
create function public.get_fanmade_catalog(p_owner_id uuid,p_page integer default 1,p_query text default '',p_form_id bigint default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_base jsonb;v_total integer;v_variants integer;v_items jsonb;
begin
  if p_page is null or p_page not between 1 and 10000 or p_query is null or length(p_query)>100 then raise exception 'invalid page'; end if;
  v_base:=public.manage_fanmade(p_owner_id,'list',jsonb_build_object('page',1,'query',p_query,'formId',p_form_id));
  with matching as (
    select d.catalog_group_id
    from public.fanmade_details d join public.products p on p.id=d.product_id left join public.works w on w.id=p.work_id
    where d.owner_id=p_owner_id and (p_query='' or position(lower(p_query) in lower(d.title||' '||d.craft||' '||coalesce(w.title_zh,'')))>0)
    group by d.catalog_group_id
  ) select count(distinct d.catalog_group_id),count(*) into v_total,v_variants
    from matching g join public.fanmade_details d on d.catalog_group_id=g.catalog_group_id and d.owner_id=p_owner_id;
  with matching as (
    select d.catalog_group_id,max(p.created_at) newest
    from public.fanmade_details d join public.products p on p.id=d.product_id left join public.works w on w.id=p.work_id
    where d.owner_id=p_owner_id and (p_query='' or position(lower(p_query) in lower(d.title||' '||d.craft||' '||coalesce(w.title_zh,'')))>0)
    group by d.catalog_group_id
  ), chosen as (
    select * from matching order by newest desc,catalog_group_id limit 24 offset (p_page-1)*24
  ), items as (
    select g.newest,g.catalog_group_id,d.craft,p.id,
      jsonb_build_object('id',p.id,'catalogGroupId',d.catalog_group_id,'sku',p.sku,'title',d.title,'craft',d.craft,
        'ip',coalesce(w.title_zh,'未分類'),'ipId',p.work_id,'stock',p.stock,'reserved',private.fanmade_reserved(p.id),
        'active',d.is_active,'imagePaths',p.image_paths,'updatedAt',p.updated_at,'videoStatus',j.status,'videoError',j.error,
        'listed',exists(select 1 from public.claim_form_products l where l.product_id=p.id and l.form_id=p_form_id)) item
    from chosen g join public.fanmade_details d on d.catalog_group_id=g.catalog_group_id and d.owner_id=p_owner_id
    join public.products p on p.id=d.product_id left join public.works w on w.id=p.work_id
    left join private.fanmade_video_jobs j on j.id=d.video_job_id
  ) select coalesce(jsonb_agg(item order by newest desc,catalog_group_id,craft,id),'[]') into v_items from items;
  return v_base||jsonb_build_object('products',v_items,'total',v_total,'variantTotal',v_variants);
end $$;
revoke all on function public.get_fanmade_catalog(uuid,integer,text,bigint) from public,anon;
grant execute on function public.get_fanmade_catalog(uuid,integer,text,bigint) to authenticated;
-- Replaced public token-scoped functions retain their narrow existing grants.
notify pgrst,'reload schema';
commit;
