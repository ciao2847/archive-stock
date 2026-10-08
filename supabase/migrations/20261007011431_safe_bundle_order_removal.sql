-- Keep the legacy draft-only RPC for older clients. This new RPC allows an
-- inventory member to remove an unchanged record after financial/check reversal.
create or replace function private.delete_bundle_claim_order(
  p_owner_id uuid,
  p_order_id bigint,
  p_expected_updated_at timestamptz default null
)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.bundle_claim_orders%rowtype;
  v_paths text[];
begin
  perform private.assert_bundle_inventory_access(p_owner_id);
  select * into v_order from public.bundle_claim_orders
    where id = p_order_id and owner_id = p_owner_id for update;
  if not found then
    raise exception 'bundle claim order not found';
  end if;
  if p_expected_updated_at is not null
     and v_order.updated_at is distinct from p_expected_updated_at then
    raise exception 'bundle claim order changed';
  end if;
  if exists (select 1 from public.bundle_claim_payments where order_id = p_order_id) then
    raise exception 'bundle claim order has payment';
  end if;
  if v_order.receiving_checked_at is not null or v_order.outbound_checked_at is not null then
    raise exception 'bundle claim order has checks';
  end if;
  select coalesce(array_agg(storage_path), array[]::text[]) into v_paths
    from public.bundle_claim_order_images where order_id = p_order_id;
  delete from public.bundle_claim_orders where id = p_order_id and owner_id = p_owner_id;
  return v_paths;
end;
$$;
revoke all on function private.delete_bundle_claim_order(uuid,bigint,timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function private.delete_bundle_claim_order(uuid,bigint,timestamptz)
  to authenticated;

create or replace function public.delete_bundle_claim_order(
  p_owner_id uuid,
  p_order_id bigint,
  p_expected_updated_at timestamptz default null
)
returns text[]
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.delete_bundle_claim_order(p_owner_id,p_order_id,p_expected_updated_at)
$$;
revoke all on function public.delete_bundle_claim_order(uuid,bigint,timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.delete_bundle_claim_order(uuid,bigint,timestamptz)
  to authenticated;
