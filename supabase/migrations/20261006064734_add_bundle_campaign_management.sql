create table public.bundle_claim_campaigns (
  id bigint generated always as identity primary key,
  owner_id uuid not null references public.inventory_databases(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 2000),
  public_token uuid not null default gen_random_uuid() unique,
  enabled boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id,owner_id)
);
create index bundle_campaigns_owner_created_idx on public.bundle_claim_campaigns(owner_id,created_at desc,id desc);
create index bundle_campaigns_created_by_idx on public.bundle_claim_campaigns(created_by);
alter table public.bundle_claim_orders add column campaign_id bigint;
alter table public.bundle_claim_orders add constraint bundle_orders_campaign_owner_fk
  foreign key(campaign_id,owner_id) references public.bundle_claim_campaigns(id,owner_id) on delete restrict;
create index bundle_orders_campaign_owner_idx on public.bundle_claim_orders(campaign_id,owner_id);

-- Preserve every inventory's existing link and publication status.
insert into public.bundle_claim_campaigns(owner_id,title,public_token,enabled)
  select id,'原有大禮包活動',bundle_menu_token,bundle_menu_enabled from public.inventory_databases;
update public.bundle_claim_orders orders set campaign_id=campaign.id
  from public.bundle_claim_campaigns campaign where campaign.owner_id=orders.owner_id;

alter table public.bundle_claim_campaigns enable row level security;
revoke all on public.bundle_claim_campaigns from public,anon,authenticated;
grant select on public.bundle_claim_campaigns to authenticated;
grant select,insert,update,delete on public.bundle_claim_campaigns to service_role;
create policy "inventory members read bundle campaigns" on public.bundle_claim_campaigns
  for select to authenticated using ((select private.can_manage_bundle_inventory(owner_id)));

create function private.save_bundle_claim_campaign(
  p_owner_id uuid,p_campaign_id bigint,p_title text,p_description text,p_enabled boolean
) returns setof public.bundle_claim_campaigns
language plpgsql security definer set search_path='' as $$
begin
  perform private.assert_bundle_inventory_access(p_owner_id);
  if (p_title is not null and char_length(btrim(p_title)) not between 1 and 120)
    or char_length(p_description)>2000 or (p_campaign_id is null and p_title is null) then
    raise exception 'invalid bundle campaign';
  end if;
  if p_campaign_id is null then
    return query insert into public.bundle_claim_campaigns(owner_id,title,description,enabled,created_by)
      values(p_owner_id,btrim(p_title),btrim(coalesce(p_description,'')),coalesce(p_enabled,false),(select auth.uid())) returning *;
  else
    return query update public.bundle_claim_campaigns set title=coalesce(btrim(p_title),title),description=coalesce(btrim(p_description),description),
      enabled=coalesce(p_enabled,enabled),updated_at=now() where id=p_campaign_id and owner_id=p_owner_id returning *;
    if not found then raise exception 'bundle campaign not found'; end if;
  end if;
end;
$$;
revoke all on function private.save_bundle_claim_campaign(uuid,bigint,text,text,boolean) from public,anon,authenticated,service_role;
grant execute on function private.save_bundle_claim_campaign(uuid,bigint,text,text,boolean) to authenticated;
create function public.save_bundle_claim_campaign(p_owner_id uuid,p_campaign_id bigint,p_title text,p_description text,p_enabled boolean)
returns setof public.bundle_claim_campaigns language sql volatile security invoker set search_path='' as $$
  select * from private.save_bundle_claim_campaign(p_owner_id,p_campaign_id,p_title,p_description,p_enabled)
$$;
revoke all on function public.save_bundle_claim_campaign(uuid,bigint,text,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.save_bundle_claim_campaign(uuid,bigint,text,text,boolean) to authenticated;

-- Older clients and future inventories automatically target the legacy campaign.
create function private.assign_legacy_bundle_campaign() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.campaign_id is null then
    insert into public.bundle_claim_campaigns(owner_id,title,public_token,enabled)
      select id,'原有大禮包活動',bundle_menu_token,bundle_menu_enabled from public.inventory_databases where id=new.owner_id
      on conflict(public_token) do nothing;
    select campaign.id into new.campaign_id from public.bundle_claim_campaigns campaign
      join public.inventory_databases inventory on inventory.bundle_menu_token=campaign.public_token
      where inventory.id=new.owner_id;
  end if;
  return new;
end;
$$;
revoke all on function private.assign_legacy_bundle_campaign() from public,anon,authenticated,service_role;
create trigger bundle_orders_assign_legacy_campaign before insert on public.bundle_claim_orders
  for each row execute function private.assign_legacy_bundle_campaign();

-- Keep the legacy menu control working during release and for older clients.
create function private.sync_legacy_bundle_menu() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  update public.bundle_claim_campaigns set enabled=new.bundle_menu_enabled,updated_at=now()
    where public_token=new.bundle_menu_token and enabled is distinct from new.bundle_menu_enabled;
  return new;
end;
$$;
revoke all on function private.sync_legacy_bundle_menu() from public,anon,authenticated,service_role;
create trigger inventory_sync_legacy_bundle_menu after update of bundle_menu_enabled on public.inventory_databases
  for each row execute function private.sync_legacy_bundle_menu();

-- New named RPCs avoid overloading the existing compatibility RPCs.
create function private.create_campaign_bundle_claim_order(
  p_owner_id uuid,p_campaign_id bigint,p_title text,p_description text,p_total_amount numeric,p_customer_hint text,p_expires_at timestamptz
) returns table(order_id bigint,public_token uuid)
language plpgsql security definer set search_path='' as $$
declare v_order record;
begin
  perform private.assert_bundle_inventory_access(p_owner_id);
  perform 1 from public.bundle_claim_campaigns where id=p_campaign_id and owner_id=p_owner_id for share;
  if not found then raise exception 'invalid bundle campaign'; end if;
  select * into v_order from private.create_bundle_claim_order(p_owner_id,p_title,p_description,p_total_amount,p_customer_hint,p_expires_at);
  update public.bundle_claim_orders set campaign_id=p_campaign_id where id=v_order.order_id;
  return query select v_order.order_id,v_order.public_token;
end;
$$;
revoke all on function private.create_campaign_bundle_claim_order(uuid,bigint,text,text,numeric,text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function private.create_campaign_bundle_claim_order(uuid,bigint,text,text,numeric,text,timestamptz) to authenticated;
create function public.create_campaign_bundle_claim_order(
  p_owner_id uuid,p_campaign_id bigint,p_title text,p_description text,p_total_amount numeric,p_customer_hint text,p_expires_at timestamptz
) returns table(order_id bigint,public_token uuid) language sql volatile security invoker set search_path='' as $$
  select * from private.create_campaign_bundle_claim_order(p_owner_id,p_campaign_id,p_title,p_description,p_total_amount,p_customer_hint,p_expires_at)
$$;
revoke all on function public.create_campaign_bundle_claim_order(uuid,bigint,text,text,numeric,text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.create_campaign_bundle_claim_order(uuid,bigint,text,text,numeric,text,timestamptz) to authenticated;
create function private.update_campaign_bundle_claim_order_draft(
  p_owner_id uuid,p_campaign_id bigint,p_order_id bigint,p_title text,p_description text,p_total_amount numeric,p_customer_hint text,p_expires_at timestamptz
) returns boolean language plpgsql security definer set search_path='' as $$
begin
  perform private.assert_bundle_inventory_access(p_owner_id);
  perform 1 from public.bundle_claim_campaigns where id=p_campaign_id and owner_id=p_owner_id for share;
  if not found then raise exception 'invalid bundle campaign'; end if;
  perform private.update_bundle_claim_order_draft(p_owner_id,p_order_id,p_title,p_description,p_total_amount,p_customer_hint,p_expires_at);
  update public.bundle_claim_orders set campaign_id=p_campaign_id where id=p_order_id;
  return true;
end;
$$;
revoke all on function private.update_campaign_bundle_claim_order_draft(uuid,bigint,bigint,text,text,numeric,text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function private.update_campaign_bundle_claim_order_draft(uuid,bigint,bigint,text,text,numeric,text,timestamptz) to authenticated;
create function public.update_campaign_bundle_claim_order_draft(
  p_owner_id uuid,p_campaign_id bigint,p_order_id bigint,p_title text,p_description text,p_total_amount numeric,p_customer_hint text,p_expires_at timestamptz
) returns boolean language sql volatile security invoker set search_path='' as $$
  select private.update_campaign_bundle_claim_order_draft(p_owner_id,p_campaign_id,p_order_id,p_title,p_description,p_total_amount,p_customer_hint,p_expires_at)
$$;
revoke all on function public.update_campaign_bundle_claim_order_draft(uuid,bigint,bigint,text,text,numeric,text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.update_campaign_bundle_claim_order_draft(uuid,bigint,bigint,text,text,numeric,text,timestamptz) to authenticated;

create or replace function public.confirm_bundle_menu_order(
  p_menu_token uuid,p_order_id bigint,p_nickname text,p_phone text,p_notes text,p_request_id uuid
) returns table(order_id bigint,confirmation_code text,submitted_at timestamptz)
language plpgsql volatile security invoker set search_path='' as $$
declare v_campaign public.bundle_claim_campaigns%rowtype; v_order public.bundle_claim_orders%rowtype;
begin
  if session_user not in ('postgres','service_role') and current_user<>'service_role' then raise exception 'service role required'; end if;
  if p_request_id is null then raise exception 'invalid request id'; end if;
  select * into v_campaign from public.bundle_claim_campaigns where public_token=p_menu_token and enabled for share;
  if not found then raise exception 'bundle menu is unavailable'; end if;
  select * into v_order from public.bundle_claim_orders
    where id=p_order_id and owner_id=v_campaign.owner_id and campaign_id=v_campaign.id for update;
  if not found then raise exception 'bundle menu order is unavailable'; end if;
  if v_order.status='confirmed' and v_order.confirmation_request_id is distinct from p_request_id then
    raise exception 'bundle menu order is already confirmed';
  end if;
  return query select confirmed.order_id,confirmed.confirmation_code,confirmed.submitted_at
    from public.confirm_bundle_claim_order(v_order.public_token,p_nickname,p_phone,p_notes,p_request_id) confirmed;
end;
$$;
-- Existing service-only execution grants remain unchanged.
create or replace function private.open_bundle_claim_order(
  p_owner_id uuid,
  p_order_id bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_bundle_inventory_access(p_owner_id);
  update public.bundle_claim_orders bundle_order
  set status = 'open',
      updated_at = now()
  where bundle_order.id = p_order_id
    and bundle_order.owner_id = p_owner_id
    and bundle_order.status = 'draft'
    and (bundle_order.expires_at is null or bundle_order.expires_at > now())
    and exists (
      select 1
      from public.bundle_claim_order_images image
      where image.order_id = bundle_order.id
    );
  if not found then
    raise exception 'bundle claim cannot be opened';
  end if;
  return true;
end;
$$;


create or replace function private.delete_bundle_claim_order_image(
  p_owner_id uuid,
  p_order_id bigint,
  p_image_id bigint
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_storage_path text;
begin
  perform private.assert_bundle_inventory_access(p_owner_id);
  perform 1
  from public.bundle_claim_orders bundle_order
  where bundle_order.id = p_order_id
    and bundle_order.owner_id = p_owner_id
    and bundle_order.status = 'draft'
  for update;
  if not found then
    raise exception 'bundle claim draft not found';
  end if;

  delete from public.bundle_claim_order_images image
  where image.id = p_image_id
    and image.order_id = p_order_id
  returning image.storage_path into v_storage_path;
  if not found then
    raise exception 'bundle claim image not found';
  end if;
  return v_storage_path;
end;
$$;


notify pgrst,'reload schema';
