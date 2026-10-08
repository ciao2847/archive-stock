begin;

alter table public.inventory_databases
  add column bundle_menu_token uuid not null default gen_random_uuid(),
  add column bundle_menu_enabled boolean not null default false;

alter table public.inventory_databases
  add constraint inventory_databases_bundle_menu_token_key unique (bundle_menu_token);

create or replace function public.confirm_bundle_menu_order(
  p_menu_token uuid,
  p_order_id bigint,
  p_nickname text,
  p_phone text,
  p_notes text,
  p_request_id uuid
)
returns table(order_id bigint, confirmation_code text, submitted_at timestamptz)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_inventory_id uuid;
  v_order public.bundle_claim_orders%rowtype;
begin
  if session_user not in ('postgres', 'service_role')
    and current_user <> 'service_role'
  then
    raise exception 'service role required';
  end if;
  if p_request_id is null then
    raise exception 'invalid request id';
  end if;

  -- Keep menu disabling and confirmation ordered within one transaction.
  select inventory.id into v_inventory_id
  from public.inventory_databases inventory
  where inventory.bundle_menu_token = p_menu_token
    and inventory.bundle_menu_enabled
  for share;
  if not found then
    raise exception 'bundle menu is unavailable';
  end if;

  select * into v_order
  from public.bundle_claim_orders bundle_order
  where bundle_order.id = p_order_id
    and bundle_order.owner_id = v_inventory_id
  for update;
  if not found then
    raise exception 'bundle menu order is unavailable';
  end if;

  if v_order.status = 'confirmed'
    and v_order.confirmation_request_id is distinct from p_request_id
  then
    raise exception 'bundle menu order is already confirmed';
  end if;

  return query
  select confirmed.order_id, confirmed.confirmation_code, confirmed.submitted_at
  from public.confirm_bundle_claim_order(
    v_order.public_token, p_nickname, p_phone, p_notes, p_request_id
  ) confirmed;
end;
$$;

revoke all on function public.confirm_bundle_menu_order(uuid, bigint, text, text, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.confirm_bundle_menu_order(uuid, bigint, text, text, text, uuid)
  to service_role;

notify pgrst, 'reload schema';
commit;
