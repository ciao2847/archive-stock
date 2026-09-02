alter table public.customers
  add column if not exists nickname text;

alter table public.orders
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id);

create index if not exists orders_active_created_at_idx
  on public.orders(created_at desc)
  where deleted_at is null;

create or replace function public.update_order_details(
  p_order_id uuid,
  p_customer_name text,
  p_customer_nickname text,
  p_customer_contact text,
  p_payment_status text,
  p_notes text,
  p_sales_channel text,
  p_discount numeric,
  p_shipping_income numeric,
  p_platform_fee numeric,
  p_seller_shipping_cost numeric,
  p_items jsonb
)
returns boolean
language plpgsql security invoker set search_path=public
as $$
declare
  v_status public.order_status;
  v_customer_id uuid;
  v_item jsonb;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if nullif(trim(p_customer_name),'') is null then raise exception 'customer name is required'; end if;
  if p_discount < 0 or p_shipping_income < 0 or p_platform_fee < 0 or p_seller_shipping_cost < 0 then
    raise exception 'financial amounts cannot be negative';
  end if;

  select status,customer_id into v_status,v_customer_id
  from public.orders
  where id=p_order_id and deleted_at is null
  for update;
  if not found then raise exception 'order not found'; end if;
  if v_status not in ('pending','packing') then raise exception 'order is locked'; end if;
  if exists(select 1 from public.settlement_orders where order_id=p_order_id) then raise exception 'settled order cannot be changed'; end if;

  update public.customers set
    name=trim(p_customer_name),
    nickname=nullif(trim(p_customer_nickname),''),
    contact=nullif(trim(p_customer_contact),'')
  where id=v_customer_id;

  update public.orders set
    payment_status=p_payment_status,
    notes=nullif(trim(p_notes),''),
    sales_channel=coalesce(nullif(trim(p_sales_channel),''),'direct'),
    discount=p_discount,
    shipping_income=p_shipping_income,
    platform_fee=p_platform_fee,
    seller_shipping_cost=p_seller_shipping_cost,
    updated_at=now()
  where id=p_order_id;

  for v_item in select value from jsonb_array_elements(p_items) loop
    if (v_item->>'unit_price')::numeric < 0 then raise exception 'unit price cannot be negative'; end if;
    update public.order_items
    set unit_price=(v_item->>'unit_price')::numeric
    where id=(v_item->>'id')::uuid and order_id=p_order_id;
    if not found then raise exception 'order item not found'; end if;
  end loop;
  return true;
end $$;

revoke execute on function public.update_order_details(uuid,text,text,text,text,text,text,numeric,numeric,numeric,numeric,jsonb) from public, anon;
grant execute on function public.update_order_details(uuid,text,text,text,text,text,text,numeric,numeric,numeric,numeric,jsonb) to authenticated;

create or replace function public.archive_order(p_order_id uuid)
returns boolean
language plpgsql security invoker set search_path=public
as $$
declare
  v_status public.order_status;
begin
  if auth.uid() is null or public.my_role() <> 'admin' then raise exception 'admin access required'; end if;

  select status into v_status
  from public.orders
  where id=p_order_id and deleted_at is null
  for update;
  if not found then raise exception 'order not found'; end if;
  if v_status not in ('pending','packing') then raise exception 'only pending orders can be deleted'; end if;
  if exists(select 1 from public.settlement_orders where order_id=p_order_id) then raise exception 'settled order cannot be deleted'; end if;

  update public.product_qr_labels
  set status='active',used_order_id=null,used_by=null,used_at=null
  where used_order_id=p_order_id and status='used';

  update public.order_items set scanned_quantity=0 where order_id=p_order_id;

  update public.products p
  set status='in_stock',updated_at=now()
  where exists(
    select 1 from public.order_items oi
    where oi.order_id=p_order_id and oi.product_id=p.id
  );

  update public.orders
  set status='cancelled',deleted_at=now(),deleted_by=auth.uid(),updated_at=now()
  where id=p_order_id;
  return true;
end $$;

revoke execute on function public.archive_order(uuid) from public, anon;
grant execute on function public.archive_order(uuid) to authenticated;
