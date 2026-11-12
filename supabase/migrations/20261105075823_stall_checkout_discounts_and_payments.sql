begin;
-- Historical sales have no recorded payment method; do not assume cash.
alter table public.orders add column stall_payment_method text not null default 'unspecified'
  check (stall_payment_method in ('cash','transfer','line_pay','card','other','unspecified'));
create or replace function public.checkout_stall_labels(
  p_owner_id uuid, p_tokens uuid[], p_expected_total numeric,
  p_discount numeric, p_payment_method text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_order_no text;
  v_items jsonb;
  v_total numeric;
  v_existing_order_id uuid;
  v_discount numeric;
  v_payment_method text;
begin
  if (select auth.uid()) is null or coalesce(public.my_role()::text, '') not in ('admin', 'staff') then
    raise exception 'employee access required';
  end if;
  if p_owner_id is null or p_tokens is null or cardinality(p_tokens) not between 1 and 100
    or exists (select 1 from unnest(p_tokens) token where token is null)
    or (select count(distinct token) from unnest(p_tokens) token) <> cardinality(p_tokens) then
    raise exception 'invalid checkout labels';
  end if;
  if p_expected_total is null or p_expected_total < 0 then
    raise exception 'invalid checkout total';
  end if;

  if p_owner_id is distinct from (select private.current_inventory_owner_id())
    and (select public.my_role()) <> 'admin' then raise exception 'owner access required'; end if;
  if p_discount is null or p_discount < 0 or p_discount > 99999999.99
    or p_discount <> round(p_discount, 2) or p_discount::text in ('NaN','Infinity','-Infinity') then
    raise exception 'invalid checkout discount';
  end if;
  if p_payment_method is null or p_payment_method not in ('cash','transfer','line_pay','card','other') then
    raise exception 'invalid checkout payment method';
  end if;

  -- Lock labels first, matching the existing QR scanning workflow. Each label
  -- represents one physical unit. Row visibility remains governed by RLS.
  perform 1 from public.product_qr_labels q
  where q.token = any(p_tokens) order by q.id for update;
  if (select count(*) from public.product_qr_labels q
      join public.products p on p.id = q.product_id
      where q.token = any(p_tokens) and p.owner_id = p_owner_id) <> cardinality(p_tokens) then
    raise exception 'checkout label not found';
  end if;

  -- A retry after a lost response returns the completed sale, rather than
  -- charging again. Only the exact original set of labels qualifies.
  select min(q.used_order_id::text)::uuid into v_existing_order_id
  from public.product_qr_labels q where q.token = any(p_tokens);
  if v_existing_order_id is not null and not exists (
    select 1 from public.product_qr_labels q where q.token = any(p_tokens)
    and (q.status <> 'used' or q.used_order_id is distinct from v_existing_order_id)
  ) and (select count(*) from public.product_qr_labels q
         where q.used_order_id = v_existing_order_id) = cardinality(p_tokens) then
    select o.order_no, sum(oi.quantity * oi.unit_price), o.discount, o.stall_payment_method
    into v_order_no, v_total, v_discount, v_payment_method
    from public.orders o join public.order_items oi on oi.order_id = o.id
    where o.id = v_existing_order_id and o.owner_id = p_owner_id
      and o.deleted_at is null and o.notes = '攤位掃碼結帳'
    group by o.order_no, o.discount, o.stall_payment_method;
    if found then
      return jsonb_build_object('orderId', v_existing_order_id, 'orderNo', v_order_no, 'subtotal', v_total, 'discount', v_discount, 'paymentMethod', v_payment_method, 'total', v_total - v_discount);
    end if;
  end if;
  if exists (select 1 from public.product_qr_labels q
             where q.token = any(p_tokens) and q.status <> 'active') then
    raise exception 'checkout label unavailable';
  end if;

  perform 1 from public.products p
  where p.id in (select q.product_id from public.product_qr_labels q where q.token = any(p_tokens))
  order by p.id for update;
  if exists (
    select 1 from public.products p
    join (select q.product_id, count(*) as quantity from public.product_qr_labels q
          where q.token = any(p_tokens) group by q.product_id) quantities on quantities.product_id = p.id
    where p.status <> 'in_stock' or p.stock < quantities.quantity
  ) then raise exception 'product is not available'; end if;

  select jsonb_agg(jsonb_build_object('product_id', p.id, 'quantity', quantities.quantity,
                                    'unit_price', coalesce(p.price, 0) + 150) order by p.id),
         sum((coalesce(p.price, 0) + 150) * quantities.quantity)
  into v_items, v_total
  from public.products p
  join (select q.product_id, count(*) as quantity from public.product_qr_labels q
        where q.token = any(p_tokens) group by q.product_id) quantities on quantities.product_id = p.id;
  if v_total <> p_expected_total then raise exception 'checkout price changed'; end if;

  if p_discount > v_total then raise exception 'invalid checkout discount'; end if;
  v_order_id := public.create_order_with_items(
    '攤位現場客人', '', '', 'paid', '攤位掃碼結帳', 'direct', p_discount, 0, 0, 0, v_items
  );
  update public.order_items set packed_quantity = quantity where order_id = v_order_id;
  update public.products p
  set stock = p.stock - quantities.quantity,
      status = case when p.stock - quantities.quantity = 0 then 'packed'::public.product_status
                    else 'in_stock'::public.product_status end,
      updated_at = now()
  from (select q.product_id, count(*)::integer as quantity from public.product_qr_labels q
        where q.token = any(p_tokens) group by q.product_id) quantities
  where p.id = quantities.product_id;
  update public.product_qr_labels
  set status = 'used', used_order_id = v_order_id, used_by = (select auth.uid()), used_at = now()
  where token = any(p_tokens);
  update public.orders
  set stall_payment_method = p_payment_method, status = 'packed', packed_at = now(), packed_by = (select auth.uid()), updated_at = now()
  where id = v_order_id returning order_no into v_order_no;
  return jsonb_build_object('orderId', v_order_id, 'orderNo', v_order_no, 'subtotal', v_total, 'discount', p_discount, 'paymentMethod', p_payment_method, 'total', v_total - p_discount);
end;
$$;
revoke all on function public.checkout_stall_labels(uuid, uuid[], numeric, numeric, text) from public, anon;
grant execute on function public.checkout_stall_labels(uuid, uuid[], numeric, numeric, text) to authenticated;

-- Preserve old clients during deployment and retries.
create or replace function public.checkout_stall_labels(p_owner_id uuid,p_tokens uuid[],p_expected_total numeric)
returns jsonb language sql security invoker set search_path = '' as $$
 select public.checkout_stall_labels(p_owner_id,p_tokens,p_expected_total,0,'cash');
$$;
revoke all on function public.checkout_stall_labels(uuid,uuid[],numeric) from public,anon;
grant execute on function public.checkout_stall_labels(uuid,uuid[],numeric) to authenticated;
create function public.manage_stall_order(
  p_owner_id uuid, p_order_id uuid, p_expected_revision integer, p_action text,
  p_items jsonb, p_note text, p_discount numeric, p_payment_method text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_order public.orders;
  v_day date;
  v_period date;
  v_ids uuid[];
  v_old_tokens uuid[];
  v_tokens uuid[];
  v_product record;
  v_old_quantity integer;
  v_new_quantity integer;
  v_price numeric;
  v_total numeric;
begin
  if (select auth.uid()) is null or coalesce((select public.my_role())::text,'') not in ('admin','staff') then
    raise exception 'employee access required';
  end if;
  if p_owner_id is null or (p_owner_id is distinct from (select private.current_inventory_owner_id()) and (select public.my_role())<>'admin') then raise exception 'owner access required'; end if;
  if p_action is null or p_action not in ('edit','cancel') or p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'invalid stall operation';
  end if;
  select * into v_order from public.orders o where o.id=p_order_id and o.owner_id=p_owner_id and o.deleted_at is null
    and o.notes='攤位掃碼結帳'
    and (o.owner_id=(select private.current_inventory_owner_id()) or (select public.my_role())='admin');
  if not found then raise exception 'stall order not found'; end if;
  v_day := (coalesce(v_order.packed_at,v_order.created_at) at time zone 'Asia/Taipei')::date;
  v_period := make_date(extract(year from v_day)::integer, ((extract(month from v_day)::integer-1)/2)*2+1, 1);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_order.owner_id::text || v_period::text,0));
  select * into v_order from public.orders o where o.id=p_order_id and o.owner_id=p_owner_id and o.deleted_at is null
    and o.notes='攤位掃碼結帳' for update;
  if not found then raise exception 'stall order not found'; end if;
  -- Retrying an already cancelled order never restores its stock a second time.
  if p_action='cancel' and v_order.status='cancelled' then
    return jsonb_build_object('orderId',v_order.id,'revision',v_order.stall_revision,'status','cancelled');
  end if;
  if v_order.stall_revision <> p_expected_revision then raise exception 'stall order changed'; end if;
  if v_order.status <> 'packed' or v_order.payment_status <> 'paid' then raise exception 'stall order is locked'; end if;
  if exists(select 1 from public.settlement_orders so where so.order_id=p_order_id)
    or exists(select 1 from public.settlements s where s.owner_id=v_order.owner_id and v_day between s.period_start and s.period_end) then
    raise exception 'settled order cannot be changed';
  end if;
  if exists(select 1 from public.packing_package_items x where x.order_id=p_order_id)
    or exists(select 1 from public.packing_scans x where x.order_id=p_order_id) then
    raise exception 'stall order is locked';
  end if;
  if exists(select 1 from public.order_items oi where oi.order_id=p_order_id and oi.packed_quantity<>oi.quantity) then
    raise exception 'stall order units mismatch';
  end if;
  if p_action='edit' then
    if p_note is null or length(p_note)>2000 or p_items is null or jsonb_typeof(p_items)<>'array' then
      raise exception 'invalid stall items';
    end if;
    if jsonb_array_length(p_items) not between 1 and 100 then raise exception 'invalid stall items'; end if;
    if exists(select 1 from jsonb_to_recordset(p_items) as x(product_id uuid,quantity numeric,unit_price numeric)
      where x.product_id is null or x.quantity is null or x.quantity<1 or x.quantity>100 or x.quantity<>trunc(x.quantity)
      or x.unit_price is null or x.unit_price<0 or x.unit_price>99999999.99 or x.unit_price<>round(x.unit_price,2)
      or x.quantity::text in ('NaN','Infinity','-Infinity') or x.unit_price::text in ('NaN','Infinity','-Infinity'))
      or (select sum(x.quantity) from jsonb_to_recordset(p_items) as x(quantity numeric))>100
      or (select count(distinct x.product_id) from jsonb_to_recordset(p_items) as x(product_id uuid))<>jsonb_array_length(p_items) then
      raise exception 'invalid stall items';
    end if;
    p_discount := coalesce(p_discount, v_order.discount, 0);
    p_payment_method := coalesce(p_payment_method, v_order.stall_payment_method);
    if p_discount < 0 or p_discount > 99999999.99 or p_discount <> round(p_discount,2)
      or p_discount::text in ('NaN','Infinity','-Infinity')
      or p_discount > (select sum(x.quantity*x.unit_price) from jsonb_to_recordset(p_items) as x(quantity numeric,unit_price numeric)) then
      raise exception 'invalid checkout discount';
    end if;
    if p_payment_method not in ('cash','transfer','line_pay','card','other','unspecified') then
      raise exception 'invalid checkout payment method';
    end if;
  else
    p_items := '[]'::jsonb;
  end if;
  select coalesce(array_agg(distinct x.id),'{}'::uuid[]) into v_ids from (
    select oi.product_id id from public.order_items oi where oi.order_id=p_order_id
    union select x.product_id from jsonb_to_recordset(p_items) as x(product_id uuid)
  ) x;
  -- Match the checkout workflow: labels in ID order, then products in ID order.
  perform 1 from public.product_qr_labels q where q.product_id=any(v_ids)
    and (q.status='active' or q.used_order_id=p_order_id) order by q.id for update;
  perform 1 from public.products p where p.id=any(v_ids) order by p.id for update;
  if (select count(*) from public.products p where p.id=any(v_ids) and p.owner_id=v_order.owner_id)<>cardinality(v_ids) then
    raise exception 'stall product not found';
  end if;
  if exists(select 1 from public.order_items oi where oi.order_id=p_order_id
    and oi.quantity<>(select count(*) from public.product_qr_labels q where q.product_id=oi.product_id and q.used_order_id=p_order_id and q.status='used')) then
    raise exception 'stall order units mismatch';
  end if;
  select coalesce(array_agg(q.token),'{}'::uuid[]) into v_old_tokens from public.product_qr_labels q where q.used_order_id=p_order_id;
  for v_product in select * from public.products p where p.id=any(v_ids) order by p.id loop
    select coalesce(sum(oi.packed_quantity),0)::integer into v_old_quantity from public.order_items oi where oi.order_id=p_order_id and oi.product_id=v_product.id;
    select coalesce(sum(x.quantity),0)::integer into v_new_quantity from jsonb_to_recordset(p_items) as x(product_id uuid,quantity integer) where x.product_id=v_product.id;
    if v_new_quantity>v_old_quantity and (v_product.status<>'in_stock' or v_product.stock<v_new_quantity-v_old_quantity) then
      raise exception 'product is not available';
    end if;
    if v_new_quantity > v_old_quantity+(select count(*) from public.product_qr_labels q where q.product_id=v_product.id and q.status='active') then
      raise exception 'checkout label unavailable';
    end if;
  end loop;
  update public.product_qr_labels set status='active',used_order_id=null,used_by=null,used_at=null where used_order_id=p_order_id;
  for v_product in select * from public.products p where p.id=any(v_ids) order by p.id loop
    select coalesce(sum(oi.packed_quantity),0)::integer into v_old_quantity from public.order_items oi where oi.order_id=p_order_id and oi.product_id=v_product.id;
    select coalesce(sum(x.quantity),0)::integer,max(x.unit_price) into v_new_quantity,v_price
      from jsonb_to_recordset(p_items) as x(product_id uuid,quantity integer,unit_price numeric) where x.product_id=v_product.id;
    update public.products set stock=stock+v_old_quantity-v_new_quantity,updated_at=now() where id=v_product.id;
    if p_action='edit' then
      if v_new_quantity=0 then
        delete from public.order_items where order_id=p_order_id and product_id=v_product.id;
      else
        update public.order_items set quantity=v_new_quantity,packed_quantity=v_new_quantity,unit_price=v_price
          where order_id=p_order_id and product_id=v_product.id;
        if not found then
          insert into public.order_items(order_id,product_id,quantity,packed_quantity,unit_price)
          values(p_order_id,v_product.id,v_new_quantity,v_new_quantity,v_price);
        end if;
        select array_agg(x.token) into v_tokens from (
          select q.token from public.product_qr_labels q where q.product_id=v_product.id and q.status='active'
          order by case when q.token=any(v_old_tokens) then 0 else 1 end,q.id limit v_new_quantity
        ) x;
        if coalesce(cardinality(v_tokens),0)<>v_new_quantity then raise exception 'checkout label unavailable'; end if;
        update public.product_qr_labels set status='used',used_order_id=p_order_id,used_by=(select auth.uid()),used_at=now() where token=any(v_tokens);
      end if;
    end if;
  end loop;
  if p_action='cancel' then
    update public.order_items set packed_quantity=0,scanned_quantity=0 where order_id=p_order_id;
    update public.orders set status='cancelled',stall_revision=stall_revision+1,updated_at=now() where id=p_order_id;
  else
    update public.orders set discount=p_discount,stall_payment_method=p_payment_method,stall_note=trim(p_note),stall_revision=stall_revision+1,updated_at=now() where id=p_order_id;
  end if;
  update public.products p set status=case
    when p.stock<=0 then 'packed'::public.product_status
    when exists(select 1 from public.order_items oi join public.orders o on o.id=oi.order_id
      where oi.product_id=p.id and o.deleted_at is null and o.status in ('pending','packing') and oi.packed_quantity<oi.quantity)
      then 'reserved'::public.product_status else 'in_stock'::public.product_status end
  where p.id=any(v_ids);
  select coalesce(sum(oi.quantity*oi.unit_price),0) into v_total from public.order_items oi where oi.order_id=p_order_id;
  return jsonb_build_object('orderId',p_order_id,'revision',v_order.stall_revision+1,'status',case when p_action='cancel' then 'cancelled' else 'packed' end,'total',v_total-coalesce(case when p_action='edit' then p_discount else v_order.discount end,0));
end;
$$;
revoke all on function public.manage_stall_order(uuid,uuid,integer,text,jsonb,text,numeric,text) from public,anon;
grant execute on function public.manage_stall_order(uuid,uuid,integer,text,jsonb,text,numeric,text) to authenticated;


create or replace function public.manage_stall_order(
 p_owner_id uuid,p_order_id uuid,p_expected_revision integer,p_action text,
 p_items jsonb default '[]'::jsonb,p_note text default ''
) returns jsonb language sql security invoker set search_path = '' as $$
 select public.manage_stall_order(p_owner_id,p_order_id,p_expected_revision,p_action,p_items,p_note,null,null);
$$;
revoke all on function public.manage_stall_order(uuid,uuid,integer,text,jsonb,text) from public,anon;
grant execute on function public.manage_stall_order(uuid,uuid,integer,text,jsonb,text) to authenticated;
create or replace function public.find_stall_orders(
  p_owner_id uuid,p_query text default '',p_start date default null,p_end date default null,
  p_status text default 'all',p_page integer default 1
) returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_search text; v_result jsonb;
begin
  if (select auth.uid()) is null or coalesce((select public.my_role())::text,'') not in ('admin','staff')
    or p_owner_id is null or (p_owner_id is distinct from (select private.current_inventory_owner_id()) and (select public.my_role())<>'admin') then
    raise exception 'owner access required';
  end if;
  if p_page is null or p_page<1 or p_page>10000 or p_status is null or p_status not in ('all','completed','cancelled')
    or length(coalesce(p_query,''))>100 or (p_start is not null and p_end is not null and p_start>p_end) then raise exception 'invalid stall search'; end if;
  v_search := '%'||replace(replace(replace(trim(coalesce(p_query,'')),E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_')||'%';
  with filtered as (
    select o.* from public.orders o where o.owner_id=p_owner_id and o.notes='攤位掃碼結帳' and o.deleted_at is null
      and (p_status='all' or (p_status='completed' and o.status in ('packed','shipped')) or (p_status='cancelled' and o.status='cancelled'))
      and (p_start is null or o.created_at>=p_start::timestamp at time zone 'Asia/Taipei')
      and (p_end is null or o.created_at<(p_end+1)::timestamp at time zone 'Asia/Taipei')
      and (v_search='%%' or o.order_no ilike v_search or exists(
        select 1 from public.order_items oi join public.products p on p.id=oi.product_id
        where oi.order_id=o.id and (p.sku ilike v_search or p.name ilike v_search)))
  ), page as (select * from filtered order by created_at desc,id limit 20 offset (p_page-1)*20)
  select jsonb_build_object('total',(select count(*) from filtered),'page',p_page,'pageSize',20,
    'orders',coalesce((select jsonb_agg(jsonb_build_object(
      'id',o.id,'orderNo',o.order_no,'createdAt',o.created_at,'status',o.status,'revision',o.stall_revision,'note',o.stall_note,
      'settled',exists(select 1 from public.settlement_orders so where so.order_id=o.id) or exists(select 1 from public.settlements s where s.owner_id=o.owner_id
        and (coalesce(o.packed_at,o.created_at) at time zone 'Asia/Taipei')::date between s.period_start and s.period_end),
      'discount',o.discount,'paymentMethod',o.stall_payment_method,
      'total',(select coalesce(sum(oi.quantity*oi.unit_price),0) from public.order_items oi where oi.order_id=o.id)-coalesce(o.discount,0),
      'items',coalesce((select jsonb_agg(jsonb_build_object('id',oi.id,'productId',p.id,'sku',p.sku,'name',p.name,
        'quantity',oi.quantity,'unitPrice',oi.unit_price,'stock',p.stock) order by p.sku)
        from public.order_items oi join public.products p on p.id=oi.product_id where oi.order_id=o.id),'[]'::jsonb)
    ) order by o.created_at desc,o.id) from page o),'[]'::jsonb)) into v_result;
  return v_result;
end;
$$;
revoke all on function public.find_stall_orders(uuid,text,date,date,text,integer) from public,anon;
grant execute on function public.find_stall_orders(uuid,text,date,date,text,integer) to authenticated;
notify pgrst,'reload schema';
commit;
