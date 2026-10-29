begin;

-- Keep one fulfillment order per source. Source records remain the payment ledger.
alter table public.orders
  add column claim_submission_id bigint references public.claim_submissions(id) on delete cascade,
  add column bundle_claim_order_id bigint references public.bundle_claim_orders(id) on delete cascade,
  add constraint orders_one_claim_source check (num_nonnulls(claim_submission_id, bundle_claim_order_id) <= 1),
  add constraint orders_claim_submission_unique unique (claim_submission_id),
  add constraint orders_bundle_claim_unique unique (bundle_claim_order_id);

create table public.bundle_fulfillment_items (
  bundle_order_id bigint not null references public.bundle_claim_orders(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity integer not null check (quantity between 1 and 999),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  primary key (bundle_order_id, product_id)
);
create index bundle_fulfillment_items_product_idx on public.bundle_fulfillment_items(product_id);
alter table public.bundle_fulfillment_items enable row level security;
revoke all on public.bundle_fulfillment_items from public, anon, authenticated;
grant select on public.bundle_fulfillment_items to authenticated;
create policy "inventory members read fulfillment mapping" on public.bundle_fulfillment_items
for select to authenticated using (exists (
  select 1 from public.bundle_claim_orders b where b.id = bundle_order_id
    and (b.owner_id = (select private.current_inventory_owner_id()) or (select public.my_role()) = 'admin')
));

-- Internal trigger target. Anonymous form submissions reach this only through
-- the existing token-validated submit RPC, never by directly calling this function.
create function private.sync_claim_fulfillment(p_source text, p_id bigint)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid; v_code text; v_name text; v_phone text; v_notes text;
  v_created timestamptz; v_creator uuid; v_paid boolean; v_order uuid; v_customer uuid;
  v_items jsonb; v_locked boolean; v_outbound timestamptz;
begin
  if p_source = 'claim' then
    select f.owner_id, s.confirmation_code, s.nickname, s.phone, s.notes, s.created_at,
      s.payment_status = 'paid' into v_owner, v_code, v_name, v_phone, v_notes, v_created, v_paid
    from public.claim_submissions s join public.claim_forms f on f.id = s.form_id
    where s.id = p_id for update of s;
    if not found then return null; end if;
    select coalesce(jsonb_agg(jsonb_build_object('product_id', i.product_id, 'quantity', i.quantity, 'unit_price', i.unit_price) order by i.product_id), '[]')
    into v_items from public.claim_submission_items i where i.submission_id = p_id;
  elsif p_source = 'bundle' then
    select b.owner_id, b.confirmation_code, b.customer_nickname, b.customer_phone, b.customer_notes,
      b.confirmed_at, exists(select 1 from public.bundle_claim_payments p where p.order_id = b.id), b.outbound_checked_at
    into v_owner, v_code, v_name, v_phone, v_notes, v_created, v_paid, v_outbound
    from public.bundle_claim_orders b where b.id = p_id and b.status = 'confirmed' for update of b;
    if not found then return null; end if;
    select coalesce(jsonb_agg(jsonb_build_object('product_id', i.product_id, 'quantity', i.quantity, 'unit_price', i.unit_price) order by i.product_id), '[]')
    into v_items from public.bundle_fulfillment_items i where i.bundle_order_id = p_id;
  else raise exception 'invalid fulfillment source'; end if;

  -- Preserve historical sources with missing products as an unready order.
  -- Never partially fulfill a source after silently dropping a missing item.
  if exists(select 1 from jsonb_array_elements(v_items) i left join public.products p
    on p.id = (i->>'product_id')::uuid and p.owner_id = v_owner where p.id is null) then
    v_items := '[]';
  end if;
  select o.id, o.customer_id into v_order, v_customer from public.orders o
  where (p_source = 'claim' and o.claim_submission_id = p_id)
     or (p_source = 'bundle' and o.bundle_claim_order_id = p_id)
  for update;
  if v_order is null then
    select p.id into v_creator from public.profiles p
      where p.inventory_owner_id = v_owner order by p.created_at, p.id limit 1;
    insert into public.customers(owner_id, name, nickname, contact, created_by)
    values(v_owner, v_name, v_name, v_phone, v_creator) returning id into v_customer;
    insert into public.orders(owner_id, customer_id, order_no, payment_status, status, notes, created_by, created_at,
      claim_submission_id, bundle_claim_order_id)
    values(v_owner, v_customer, v_code, case when v_paid then 'paid' else 'pending' end, case when v_outbound is not null then 'shipped'::public.order_status else 'pending'::public.order_status end, v_notes,
      v_creator, v_created, case when p_source = 'claim' then p_id end, case when p_source = 'bundle' then p_id end)
    returning id into v_order;
  else
    update public.orders set payment_status = case when v_paid then 'paid' else 'pending' end, updated_at = now()
    where id = v_order;
  end if;

  select exists(select 1 from public.order_items oi where oi.order_id = v_order
      and (oi.packed_quantity > 0 or oi.scanned_quantity > 0))
    or exists(select 1 from public.packing_package_items pi where pi.order_id = v_order)
    or exists(select 1 from public.settlement_orders so where so.order_id = v_order)
    or exists(select 1 from public.orders o where o.id = v_order and (o.deleted_at is not null or o.status in ('packed','shipped','cancelled')))
  into v_locked;
  if v_locked then
    if exists (
      (select oi.product_id, oi.quantity, oi.unit_price from public.order_items oi where oi.order_id = v_order
       except select (i->>'product_id')::uuid, (i->>'quantity')::integer, (i->>'unit_price')::numeric from jsonb_array_elements(v_items) i)
      union all
      (select (i->>'product_id')::uuid, (i->>'quantity')::integer, (i->>'unit_price')::numeric from jsonb_array_elements(v_items) i
       except select oi.product_id, oi.quantity, oi.unit_price from public.order_items oi where oi.order_id = v_order)
    ) then raise exception 'fulfillment already started'; end if;
  else
    update public.customers set name = v_name, nickname = v_name, contact = v_phone where id = v_customer;
    delete from public.order_items oi where oi.order_id = v_order
      and not exists(select 1 from jsonb_array_elements(v_items) i where (i->>'product_id')::uuid = oi.product_id);
    insert into public.order_items(order_id, product_id, quantity, unit_price)
    select v_order, (i->>'product_id')::uuid, (i->>'quantity')::integer, (i->>'unit_price')::numeric
    from jsonb_array_elements(v_items) i
    on conflict (order_id, product_id) do update set quantity = excluded.quantity, unit_price = excluded.unit_price;
  end if;
  return v_order;
end;
$$;
revoke all on function private.sync_claim_fulfillment(text,bigint) from public, anon, authenticated;

create function private.sync_claim_fulfillment_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'claim_submissions' then
    perform private.sync_claim_fulfillment('claim', new.id);
  elsif tg_table_name = 'claim_submission_items' then
    if tg_op = 'DELETE' then perform private.sync_claim_fulfillment('claim', old.submission_id);
    else perform private.sync_claim_fulfillment('claim', new.submission_id); end if;
  elsif tg_table_name = 'bundle_claim_orders' then
    if tg_op = 'UPDATE' and old.status = 'confirmed' and new.status <> 'confirmed' then
      raise exception 'confirmed fulfillment cannot be reopened';
    end if;
    if tg_op = 'UPDATE' and new.outbound_checked_at is distinct from old.outbound_checked_at
      and exists(select 1 from public.orders o where o.bundle_claim_order_id = new.id
        and exists(select 1 from public.order_items i where i.order_id = o.id)) then
      if new.outbound_checked_at is not null and not exists(select 1 from public.orders o where o.bundle_claim_order_id = new.id and o.status in ('packed','shipped')) then
        raise exception 'use packing workflow';
      elsif new.outbound_checked_at is null and exists(select 1 from public.orders o where o.bundle_claim_order_id = new.id and o.status in ('packed','shipped')) then
        raise exception 'fulfillment already started';
      end if;
    end if;
    perform private.sync_claim_fulfillment('bundle', new.id);
  elsif tg_table_name = 'bundle_claim_payments' then
    if tg_op = 'DELETE' then perform private.sync_claim_fulfillment('bundle', old.order_id);
    else perform private.sync_claim_fulfillment('bundle', new.order_id); end if;
  end if;
  return null;
end;
$$;
revoke all on function private.sync_claim_fulfillment_trigger() from public, anon, authenticated;
create trigger claim_fulfillment_submission after insert or update on public.claim_submissions
  for each row execute function private.sync_claim_fulfillment_trigger();
create trigger claim_fulfillment_item after insert or update or delete on public.claim_submission_items
  for each row execute function private.sync_claim_fulfillment_trigger();
create trigger bundle_fulfillment_confirm after insert or update on public.bundle_claim_orders
  for each row execute function private.sync_claim_fulfillment_trigger();
create trigger bundle_fulfillment_payment after insert or update or delete on public.bundle_claim_payments
  for each row execute function private.sync_claim_fulfillment_trigger();

-- A source can be removed while unfulfilled, never after scanning or packing.
create function private.guard_fulfillment_source_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_order uuid;
begin
  select o.id into v_order from public.orders o
  where (tg_table_name = 'claim_submissions' and o.claim_submission_id = old.id)
     or (tg_table_name = 'bundle_claim_orders' and o.bundle_claim_order_id = old.id) for update;
  if exists(select 1 from public.orders o where o.id = v_order and o.status in ('packed','shipped'))
    or exists(select 1 from public.order_items oi where oi.order_id = v_order and (oi.packed_quantity > 0 or oi.scanned_quantity > 0))
    or exists(select 1 from public.packing_package_items pi where pi.order_id = v_order)
    or exists(select 1 from public.settlement_orders so where so.order_id = v_order) then
    raise exception 'fulfillment already started';
  end if;
  return old;
end;
$$;
revoke all on function private.guard_fulfillment_source_delete() from public, anon, authenticated;
create trigger claim_fulfillment_delete before delete on public.claim_submissions
  for each row execute function private.guard_fulfillment_source_delete();
create trigger bundle_fulfillment_delete before delete on public.bundle_claim_orders
  for each row execute function private.guard_fulfillment_source_delete();

create function public.map_bundle_fulfillment(p_owner_id uuid, p_order_id bigint, p_items jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_total numeric; v_item jsonb; v_order uuid;
begin
  if (select auth.uid()) is null or coalesce((select public.my_role())::text,'') not in ('admin','staff') then
    raise exception 'employee access required'; end if;
  if (select public.my_role()) <> 'admin' and p_owner_id <> (select private.current_inventory_owner_id()) then
    raise exception 'owner access required'; end if;
  select b.total_amount into v_total from public.bundle_claim_orders b
    where b.id = p_order_id and b.owner_id = p_owner_id and b.status = 'confirmed' for update;
  if not found then raise exception 'confirmed bundle not found'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 100 then
    raise exception 'invalid fulfillment items'; end if;
  if (select count(*) <> count(distinct i->>'product_id') from jsonb_array_elements(p_items) i) then
    raise exception 'duplicate fulfillment products'; end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item->'quantity') is distinct from 'number'
      or (v_item->>'quantity')::numeric <> trunc((v_item->>'quantity')::numeric)
      or (v_item->>'quantity')::numeric not between 1 and 999
      or jsonb_typeof(v_item->'unit_price') is distinct from 'number'
      or (v_item->>'unit_price')::numeric < 0
      or (v_item->>'unit_price')::numeric <> round((v_item->>'unit_price')::numeric,2) then
      raise exception 'invalid fulfillment items'; end if;
    if not exists(select 1 from public.products p where p.id = (v_item->>'product_id')::uuid and p.owner_id = p_owner_id) then
      raise exception 'fulfillment product not found'; end if;
  end loop;
  if (select sum((i->>'quantity')::integer * (i->>'unit_price')::numeric) from jsonb_array_elements(p_items) i) <> v_total then
    raise exception 'fulfillment total mismatch'; end if;
  delete from public.bundle_fulfillment_items where bundle_order_id = p_order_id;
  insert into public.bundle_fulfillment_items(bundle_order_id,product_id,quantity,unit_price)
    select p_order_id, (i->>'product_id')::uuid, (i->>'quantity')::integer, (i->>'unit_price')::numeric
    from jsonb_array_elements(p_items) i;
  v_order := private.sync_claim_fulfillment('bundle', p_order_id);
  return v_order;
end;
$$;
revoke all on function public.map_bundle_fulfillment(uuid,bigint,jsonb) from public, anon;
grant execute on function public.map_bundle_fulfillment(uuid,bigint,jsonb) to authenticated;

-- Fulfillment is a projection: edits/deletions go through the source ledger.
-- Packing may still update progress/status through the existing packing RPCs.
create function private.guard_linked_fulfillment_order()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_paid boolean;
begin
  if old.claim_submission_id is null and old.bundle_claim_order_id is null then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if tg_op = 'DELETE' then
    if pg_trigger_depth() <= 1 then raise exception 'manage fulfillment through source'; end if;
    return old;
  end if;
  if (to_jsonb(new) - array['status','packed_by','packed_at','shipped_at','updated_at','payment_status'])
    is distinct from (to_jsonb(old) - array['status','packed_by','packed_at','shipped_at','updated_at','payment_status']) then
    raise exception 'manage fulfillment through source';
  end if;
  if old.claim_submission_id is not null then
    select payment_status = 'paid' into v_paid from public.claim_submissions where id = old.claim_submission_id;
  else
    select exists(select 1 from public.bundle_claim_payments where order_id = old.bundle_claim_order_id) into v_paid;
  end if;
  if new.payment_status <> (case when v_paid then 'paid' else 'pending' end) then
    raise exception 'manage fulfillment through source';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_linked_fulfillment_order() from public, anon, authenticated;
create trigger guard_linked_fulfillment_order before update or delete on public.orders
  for each row execute function private.guard_linked_fulfillment_order();

create function private.guard_linked_fulfillment_item()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_order uuid;
begin
  if tg_op = 'DELETE' then v_order := old.order_id; else v_order := new.order_id; end if;
  if current_user in ('authenticated','anon') and pg_trigger_depth() <= 1
    and exists(select 1 from public.orders where id = v_order and (claim_submission_id is not null or bundle_claim_order_id is not null)) then
    raise exception 'manage fulfillment through source';
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;
revoke all on function private.guard_linked_fulfillment_item() from public, anon, authenticated;
create trigger guard_linked_fulfillment_item before insert or update or delete on public.order_items
  for each row execute function private.guard_linked_fulfillment_item();

-- Completing a mapped bundle updates its old checklist as well, so the two
-- management screens cannot disagree about completed physical fulfillment.
create function private.reflect_bundle_packing()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.bundle_claim_order_id is not null and new.status in ('packed','shipped')
    and old.status is distinct from new.status and (select auth.uid()) is not null then
    update public.bundle_claim_orders set
      receiving_checked_at = coalesce(receiving_checked_at, now()),
      receiving_checked_by = coalesce(receiving_checked_by, (select auth.uid())),
      outbound_checked_at = coalesce(outbound_checked_at, now()),
      outbound_checked_by = coalesce(outbound_checked_by, (select auth.uid()))
    where id = new.bundle_claim_order_id;
  end if;
  return null;
end;
$$;
revoke all on function private.reflect_bundle_packing() from public, anon, authenticated;
create trigger reflect_bundle_packing after update on public.orders
  for each row execute function private.reflect_bundle_packing();

-- Backfill existing sources in the same transaction; never call the stock-
-- reserving create_order_with_items RPC, since preorders may not have arrived.
do $$ declare r record; begin
  for r in select id from public.claim_submissions order by id loop
    perform private.sync_claim_fulfillment('claim', r.id);
  end loop;
  for r in select id from public.bundle_claim_orders where status = 'confirmed' order by id loop
    perform private.sync_claim_fulfillment('bundle', r.id);
  end loop;
end $$;
notify pgrst, 'reload schema';
commit;
