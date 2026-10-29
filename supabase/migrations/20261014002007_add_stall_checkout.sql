begin;

-- One transaction records payment, delivers the scanned units and consumes
-- their labels. Prices are always read from the database, never from the client.
create or replace function public.checkout_stall_labels(
  p_owner_id uuid, p_tokens uuid[], p_expected_total numeric
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
    select o.order_no, sum(oi.quantity * oi.unit_price) into v_order_no, v_total
    from public.orders o join public.order_items oi on oi.order_id = o.id
    where o.id = v_existing_order_id and o.owner_id = p_owner_id
      and o.deleted_at is null and o.notes = '攤位掃碼結帳'
    group by o.order_no;
    if found then
      return jsonb_build_object('orderId', v_existing_order_id, 'orderNo', v_order_no, 'total', v_total);
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

  v_order_id := public.create_order_with_items(
    '攤位現場客人', '', '', 'paid', '攤位掃碼結帳', 'direct', 0, 0, 0, 0, v_items
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
  set status = 'packed', packed_at = now(), packed_by = (select auth.uid()), updated_at = now()
  where id = v_order_id returning order_no into v_order_no;
  return jsonb_build_object('orderId', v_order_id, 'orderNo', v_order_no, 'total', v_total);
end;
$$;
revoke all on function public.checkout_stall_labels(uuid, uuid[], numeric) from public, anon;
grant execute on function public.checkout_stall_labels(uuid, uuid[], numeric) to authenticated;
notify pgrst, 'reload schema';
commit;
