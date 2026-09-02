create table if not exists public.product_qr_labels (
  id uuid primary key default gen_random_uuid(),
  token uuid unique not null default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  batch_code text,
  status text not null default 'active' check (status in ('active','used','revoked')),
  used_order_id uuid references public.orders(id),
  used_by uuid references public.profiles(id),
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists product_qr_labels_product_id_idx on public.product_qr_labels(product_id);
create index if not exists product_qr_labels_active_product_idx on public.product_qr_labels(product_id) where status = 'active';
alter table public.product_qr_labels enable row level security;
create policy "team reads qr labels" on public.product_qr_labels for select to authenticated using (true);
create policy "team creates qr labels" on public.product_qr_labels for insert to authenticated with check (true);
create policy "team updates qr labels" on public.product_qr_labels for update to authenticated using (true) with check (true);

insert into public.product_qr_labels(product_id, batch_code)
select p.id, 'LEGACY-' || to_char(p.created_at, 'YYYYMMDD')
from public.products p
cross join lateral generate_series(1, p.stock)
where not exists (select 1 from public.product_qr_labels q where q.product_id = p.id);

create or replace function public.consume_product_qr(p_token uuid, p_order_id uuid)
returns table(valid boolean, reason text, product_id uuid, sku text)
language plpgsql security invoker set search_path = public
as $$
declare
  v_label public.product_qr_labels%rowtype;
  v_item public.order_items%rowtype;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select * into v_label from public.product_qr_labels where token = p_token for update;
  if not found then return query select false, 'invalid_token', null::uuid, null::text; return; end if;
  if v_label.status <> 'active' then return query select false, 'token_used', v_label.product_id, p.sku from public.products p where p.id=v_label.product_id; return; end if;
  select * into v_item from public.order_items where order_id=p_order_id and product_id=v_label.product_id for update;
  if not found or v_item.scanned_quantity >= v_item.quantity then
    insert into public.packing_scans(order_id,product_id,scanned_by,is_valid) values(p_order_id,v_label.product_id,auth.uid(),false);
    return query select false, 'wrong_order', v_label.product_id, p.sku from public.products p where p.id=v_label.product_id; return;
  end if;
  update public.product_qr_labels set status='used',used_order_id=p_order_id,used_by=auth.uid(),used_at=now() where id=v_label.id;
  update public.order_items set scanned_quantity=scanned_quantity+1 where id=v_item.id;
  insert into public.packing_scans(order_id,product_id,scanned_by,is_valid) values(p_order_id,v_label.product_id,auth.uid(),true);
  return query select true, 'ok', v_label.product_id, p.sku from public.products p where p.id=v_label.product_id;
end $$;

revoke execute on function public.consume_product_qr(uuid,uuid) from public, anon;
grant execute on function public.consume_product_qr(uuid,uuid) to authenticated;

create or replace function public.complete_order_packing(p_order_id uuid)
returns boolean language plpgsql security invoker set search_path=public as $$
declare v_status public.order_status;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select status into v_status from public.orders where id=p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  if v_status in ('packed','shipped','cancelled') then return false; end if;
  if exists(select 1 from public.order_items where order_id=p_order_id and scanned_quantity<quantity) then raise exception 'not all items have been scanned'; end if;
  if exists(select 1 from public.order_items i join public.products p on p.id=i.product_id where i.order_id=p_order_id and p.stock<i.quantity) then raise exception 'insufficient stock'; end if;
  update public.products p set stock=p.stock-i.quantity,status=case when p.stock-i.quantity=0 then 'packed'::public.product_status else 'in_stock'::public.product_status end,updated_at=now()
  from public.order_items i where i.order_id=p_order_id and p.id=i.product_id;
  update public.orders set status='packed',packed_at=now(),packed_by=auth.uid(),updated_at=now() where id=p_order_id;
  return true;
end $$;

revoke execute on function public.complete_order_packing(uuid) from public, anon;
grant execute on function public.complete_order_packing(uuid) to authenticated;
