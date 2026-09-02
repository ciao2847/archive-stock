alter table public.packing_scans
  add column if not exists scan_method text not null default 'qr';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'packing_scans_scan_method_check'
      and conrelid = 'public.packing_scans'::regclass
  ) then
    alter table public.packing_scans
      add constraint packing_scans_scan_method_check
      check (scan_method in ('qr', 'manual_sku'));
  end if;
end $$;

create or replace function public.consume_product_sku(
  p_sku text,
  p_order_id uuid
)
returns table(valid boolean, reason text, product_id uuid, sku text)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_product_id uuid;
  v_sku text;
  v_label public.product_qr_labels%rowtype;
  v_item public.order_items%rowtype;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  select p.id, p.sku
  into v_product_id, v_sku
  from public.products p
  where upper(p.sku) = upper(trim(p_sku));

  if not found then
    return query
      select false, 'invalid_sku', null::uuid, upper(trim(p_sku));
    return;
  end if;

  if not exists (
    select 1
    from public.order_items oi
    where oi.order_id = p_order_id
      and oi.product_id = v_product_id
  ) then
    insert into public.packing_scans(
      order_id,
      product_id,
      scanned_by,
      is_valid,
      scan_method
    ) values (
      p_order_id,
      v_product_id,
      auth.uid(),
      false,
      'manual_sku'
    );

    return query select false, 'wrong_order', v_product_id, v_sku;
    return;
  end if;

  select q.*
  into v_label
  from public.product_qr_labels q
  where q.product_id = v_product_id
    and q.status = 'active'
  order by q.created_at, q.id
  limit 1
  for update skip locked;

  if not found then
    return query select false, 'no_active_label', v_product_id, v_sku;
    return;
  end if;

  select oi.*
  into v_item
  from public.order_items oi
  where oi.order_id = p_order_id
    and oi.product_id = v_product_id
  for update;

  if not found or v_item.scanned_quantity >= v_item.quantity then
    insert into public.packing_scans(
      order_id,
      product_id,
      scanned_by,
      is_valid,
      scan_method
    ) values (
      p_order_id,
      v_product_id,
      auth.uid(),
      false,
      'manual_sku'
    );

    return query select false, 'wrong_order', v_product_id, v_sku;
    return;
  end if;

  update public.product_qr_labels
  set status = 'used',
      used_order_id = p_order_id,
      used_by = auth.uid(),
      used_at = now()
  where id = v_label.id;

  update public.order_items
  set scanned_quantity = scanned_quantity + 1
  where id = v_item.id;

  insert into public.packing_scans(
    order_id,
    product_id,
    scanned_by,
    is_valid,
    scan_method
  ) values (
    p_order_id,
    v_product_id,
    auth.uid(),
    true,
    'manual_sku'
  );

  return query select true, 'ok', v_product_id, v_sku;
end $$;

revoke execute on function public.consume_product_sku(text, uuid) from public, anon;
grant execute on function public.consume_product_sku(text, uuid) to authenticated;

select
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'packing_scans'
      and column_name = 'scan_method'
  )
  and to_regprocedure('public.consume_product_sku(text,uuid)') is not null
  as manual_sku_packing_ready;
