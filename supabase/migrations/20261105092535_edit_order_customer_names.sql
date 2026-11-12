begin;
CREATE OR REPLACE FUNCTION private.sync_claim_fulfillment_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin

  -- A spelling correction must not re-project items or alter payment/progress.
  if tg_op = 'UPDATE' and tg_table_name = 'claim_submissions'
    and (to_jsonb(new)->>'nickname') is distinct from (to_jsonb(old)->>'nickname')
    and (to_jsonb(new)-'nickname') = (to_jsonb(old)-'nickname') then
    update public.customers c set name=new.nickname,nickname=new.nickname
    from public.orders o where o.customer_id=c.id and o.owner_id=c.owner_id and o.claim_submission_id=new.id;
    return null;
  elsif tg_op = 'UPDATE' and tg_table_name = 'bundle_claim_orders'
    and (to_jsonb(new)->>'customer_nickname') is distinct from (to_jsonb(old)->>'customer_nickname')
    and (to_jsonb(new)-array['customer_nickname','updated_at']) = (to_jsonb(old)-array['customer_nickname','updated_at']) then
    update public.customers c set name=new.customer_nickname,nickname=new.customer_nickname
    from public.orders o where o.customer_id=c.id and o.owner_id=c.owner_id and o.bundle_claim_order_id=new.id;
    return null;
  end if;
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
$function$;
revoke all on function private.sync_claim_fulfillment_trigger() from public,anon,authenticated;

-- Source tables expose reads only. Keep this narrowly scoped mutation private,
-- authenticate before reading rows, and expose an invoker wrapper.
create function private.update_order_customer_name(
 p_owner_id uuid,p_source text,p_record_id text,p_expected_name text,p_name text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare v_name text; v_customer uuid; v_customer_row public.customers; v_order public.orders;
begin
 if (select auth.uid()) is null or coalesce((select public.my_role())::text,'') not in ('admin','staff') then raise exception 'employee access required';end if;
 if p_owner_id is null or (p_owner_id is distinct from (select private.current_inventory_owner_id()) and (select public.my_role())<>'admin') then raise exception 'owner access required';end if;
 if p_name is null or length(trim(p_name)) not between 1 and 100 or p_expected_name is null then raise exception 'invalid customer name';end if;
 p_name:=trim(p_name);
 if p_source='claim' then
  select s.nickname into v_name from public.claim_submissions s join public.claim_forms f on f.id=s.form_id
   where s.id=p_record_id::bigint and f.owner_id=p_owner_id for update of s;
  if not found then raise exception 'name record not found';end if;
  if v_name is distinct from p_expected_name then raise exception 'customer name changed';end if;
  if v_name=p_name then return true;end if;
  update public.claim_submissions set nickname=p_name where id=p_record_id::bigint;
  select customer_id into v_customer from public.orders where claim_submission_id=p_record_id::bigint and owner_id=p_owner_id;
 elsif p_source='bundle' then
  select customer_nickname into v_name from public.bundle_claim_orders where id=p_record_id::bigint and owner_id=p_owner_id and status='confirmed' for update;
  if not found then raise exception 'name record not found';end if;
  if v_name is distinct from p_expected_name then raise exception 'customer name changed';end if;
  if v_name=p_name then return true;end if;
  update public.bundle_claim_orders set customer_nickname=p_name,updated_at=now() where id=p_record_id::bigint;
  select customer_id into v_customer from public.orders where bundle_claim_order_id=p_record_id::bigint and owner_id=p_owner_id;
 elsif p_source='order' then
  select * into v_order from public.orders where id=p_record_id::uuid and owner_id=p_owner_id and deleted_at is null for update;
  if not found then raise exception 'name record not found';end if;
  if v_order.claim_submission_id is not null or v_order.bundle_claim_order_id is not null then raise exception 'edit name through source';end if;
  select * into v_customer_row from public.customers where id=v_order.customer_id and owner_id=p_owner_id for update;
  if not found then raise exception 'name record not found';end if;
  v_name:=coalesce(nullif(v_customer_row.nickname,''),v_customer_row.name,'未填寫客人');
  if v_name is distinct from p_expected_name then raise exception 'customer name changed';end if;
  if v_name=p_name then return true;end if;
  v_customer:=v_customer_row.id;
  -- Legacy orders may share a customer row. Give this order its own corrected
  -- contact without renaming other orders belonging to that customer.
  if exists(select 1 from public.orders where customer_id=v_customer and id<>v_order.id) then
   insert into public.customers(owner_id,name,nickname,contact,created_by)
   values(p_owner_id,p_name,p_name,v_customer_row.contact,(select auth.uid())) returning id into v_customer;
   update public.orders set customer_id=v_customer,updated_at=now() where id=v_order.id;
  end if;
 else raise exception 'invalid name source';end if;
 -- Also correct the linked contact after packing/settlement has started: source
 -- synchronization deliberately freezes item and contact snapshots at that point.
 if v_customer is not null then
  update public.customers set name=p_name,nickname=p_name where id=v_customer and owner_id=p_owner_id;
 end if;
 return true;
end;
$$;
revoke all on function private.update_order_customer_name(uuid,text,text,text,text) from public,anon;
grant execute on function private.update_order_customer_name(uuid,text,text,text,text) to authenticated;
create function public.update_order_customer_name(p_owner_id uuid,p_source text,p_record_id text,p_expected_name text,p_name text)
returns boolean language sql security invoker set search_path = '' as $$
 select private.update_order_customer_name(p_owner_id,p_source,p_record_id,p_expected_name,p_name);
$$;
revoke all on function public.update_order_customer_name(uuid,text,text,text,text) from public,anon;
grant execute on function public.update_order_customer_name(uuid,text,text,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
