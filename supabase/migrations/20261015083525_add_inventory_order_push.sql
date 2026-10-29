begin;
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

create table public.web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint text not null unique check (length(endpoint) between 10 and 2048),
  p256dh text not null check (length(p256dh) between 80 and 100),
  auth_key text not null check (length(auth_key) between 20 and 30),
  inventory_ids uuid[] not null check (cardinality(inventory_ids) between 1 and 50),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index web_push_subscriptions_user_idx on public.web_push_subscriptions(user_id);
create index web_push_subscriptions_inventory_idx on public.web_push_subscriptions using gin(inventory_ids);
alter table public.web_push_subscriptions enable row level security;
revoke all on public.web_push_subscriptions from anon, authenticated;
grant select, insert, update, delete on public.web_push_subscriptions to authenticated;
grant all on public.web_push_subscriptions to service_role;

create function private.can_subscribe_push(p_ids uuid[]) returns boolean
language sql stable security invoker set search_path = '' as $$
  select (select auth.uid()) is not null
    and cardinality(p_ids) between 1 and 50
    and not exists (select 1 from unnest(p_ids) as requested(inventory_id) where requested.inventory_id is null
      or not exists(select 1 from public.inventory_databases d where d.id = requested.inventory_id))
    and ((select public.my_role()) = 'admin'
      or ((select public.my_role()) = 'staff' and p_ids <@ array[(select private.current_inventory_owner_id())]));
$$;
revoke all on function private.can_subscribe_push(uuid[]) from public, anon;
grant execute on function private.can_subscribe_push(uuid[]) to authenticated;
create policy "users read own push devices" on public.web_push_subscriptions for select to authenticated using (user_id = (select auth.uid()));
create policy "users create own push devices" on public.web_push_subscriptions for insert to authenticated with check (user_id = (select auth.uid()) and private.can_subscribe_push(inventory_ids));
create policy "users update own push devices" on public.web_push_subscriptions for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and private.can_subscribe_push(inventory_ids));
create policy "users delete own push devices" on public.web_push_subscriptions for delete to authenticated using (user_id = (select auth.uid()));

create table public.order_push_events (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid not null references public.inventory_databases(id) on delete cascade,
  kind text not null check (kind in ('claim','bundle')),
  source_id bigint not null,
  created_at timestamptz not null default now(),
  unique(kind,source_id)
);
create index order_push_events_inventory_idx on public.order_push_events(inventory_id,created_at desc);
alter table public.order_push_events enable row level security;
revoke all on public.order_push_events from anon, authenticated;
grant select on public.order_push_events to authenticated;
grant all on public.order_push_events to service_role;
create policy "inventory members read order notification" on public.order_push_events for select to authenticated
using ((select public.my_role()) = 'admin' or ((select public.my_role()) = 'staff' and inventory_id = (select private.current_inventory_owner_id())));

create table public.order_push_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.order_push_events(id) on delete cascade,
  subscription_id uuid not null references public.web_push_subscriptions(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','sent','failed','skipped')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  locked_until timestamptz,
  claim_token uuid,
  last_error text,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  unique(event_id,subscription_id)
);
create index order_push_deliveries_due_idx on public.order_push_deliveries(available_at) where status = 'pending';
create index order_push_deliveries_subscription_idx on public.order_push_deliveries(subscription_id);
alter table public.order_push_deliveries enable row level security;
revoke all on public.order_push_deliveries from anon, authenticated;
grant all on public.order_push_deliveries to service_role;

-- Credentials are provisioned in Vault separately, never in migration text.
-- Network requests are dispatched asynchronously after the order commits.
create function private.wake_order_push_worker() returns void
language plpgsql security definer set search_path = '' as $$
declare v_secret text; v_url text;
begin
  if not exists (select 1 from public.order_push_deliveries where status='pending' and available_at <= now()
    and (locked_until is null or locked_until < now())) then return; end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name='order_push_cron_secret';
  select decrypted_secret into v_url from vault.decrypted_secrets where name='order_push_worker_url';
  if v_secret is null or v_url is null then return; end if;
  perform net.http_post(url := v_url, headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_secret), body := '{}'::jsonb, timeout_milliseconds := 55000);
exception when others then
  -- A transient push/network failure must not fail the customer's order.
  raise log 'Order push wake deferred; scheduled retry will handle pending deliveries';
end;
$$;
revoke all on function private.wake_order_push_worker() from public, anon, authenticated;

-- Trigger needs elevated rights only to append to the protected outbox. It
-- cannot be called as a public RPC and does not change order permissions.
create function private.enqueue_order_push() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_inventory uuid; v_event uuid; v_kind text;
begin
  if tg_table_name = 'claim_submissions' then
    select owner_id into v_inventory from public.claim_forms where id = new.form_id;
    v_kind := 'claim';
  else
    if new.status <> 'confirmed' then return new; end if;
    if tg_op = 'UPDATE' then if old.status = 'confirmed' then return new; end if; end if;
    v_inventory := new.owner_id; v_kind := 'bundle';
  end if;
  insert into public.order_push_events(inventory_id,kind,source_id)
  values(v_inventory,v_kind,new.id) on conflict(kind,source_id) do nothing returning id into v_event;
  if v_event is null then return new; end if;
  insert into public.order_push_deliveries(event_id,subscription_id)
  select v_event, s.id from public.web_push_subscriptions s
  join public.profiles p on p.id=s.user_id
  where s.inventory_ids @> array[v_inventory]
    and (p.role='admin' or (p.role='staff' and p.inventory_owner_id=v_inventory));
  perform private.wake_order_push_worker();
  return new;
end;
$$;
revoke all on function private.enqueue_order_push() from public, anon, authenticated;
create trigger queue_claim_push after insert on public.claim_submissions for each row execute function private.enqueue_order_push();
create trigger queue_bundle_push after insert or update of status on public.bundle_claim_orders for each row execute function private.enqueue_order_push();

create function public.claim_order_push_deliveries(p_limit integer default 15)
returns table(delivery_id uuid, lease_token uuid, event_id uuid, inventory_id uuid, kind text, source_id bigint,
  endpoint text, p256dh text, auth_key text)
language plpgsql security invoker set search_path = '' as $$
begin
  -- Recheck current membership and preferences, including after a retry.
  update public.order_push_deliveries d set status='skipped', locked_until=null
  from public.order_push_events e, public.web_push_subscriptions s
  where d.event_id=e.id and d.subscription_id=s.id and d.status='pending'
    and not exists(select 1 from public.profiles p where p.id=s.user_id
      and e.inventory_id=any(s.inventory_ids)
      and (p.role='admin' or (p.role='staff' and p.inventory_owner_id=e.inventory_id)));
  update public.order_push_deliveries d set status='failed', locked_until=null
    where d.status='pending' and d.attempts >= 6 and (d.locked_until is null or d.locked_until < now());
  return query
  with due as (
    select d.id from public.order_push_deliveries d
    where d.status='pending' and d.attempts < 6 and d.available_at <= now()
      and (d.locked_until is null or d.locked_until < now())
    order by d.available_at, d.id limit greatest(1,least(p_limit,30)) for update skip locked
  ), claimed as (
    update public.order_push_deliveries d set attempts=d.attempts+1,
      claim_token=gen_random_uuid(), locked_until=now()+interval '2 minutes'
    from due where d.id=due.id returning d.*
  )
  select c.id,c.claim_token,e.id,e.inventory_id,e.kind,e.source_id,s.endpoint,s.p256dh,s.auth_key
  from claimed c join public.order_push_events e on e.id=c.event_id
  join public.web_push_subscriptions s on s.id=c.subscription_id;
end;
$$;
revoke all on function public.claim_order_push_deliveries(integer) from public, anon, authenticated;
grant execute on function public.claim_order_push_deliveries(integer) to service_role;

create function public.finish_order_push_delivery(p_id uuid,p_lease uuid,p_result text,p_error text default null)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_result not in ('sent','retry','failed','skipped') then raise exception 'invalid delivery result'; end if;
  update public.order_push_deliveries set
    status=case when p_result='retry' then case when attempts>=6 then 'failed' else 'pending' end else p_result end,
    available_at=now()+make_interval(secs=>least(3600,30*power(2,attempts)::integer)),
    locked_until=null, claim_token=null,
    delivered_at=case when p_result='sent' then now() else null end,
    last_error=left(p_error,100)
  where id=p_id and claim_token=p_lease and status='pending';
end;
$$;
revoke all on function public.finish_order_push_delivery(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.finish_order_push_delivery(uuid,uuid,text,text) to service_role;

-- Durable fallback after process termination or a temporary push provider outage.
select cron.schedule('archive-order-push-retry','* * * * *','select private.wake_order_push_worker()');
notify pgrst, 'reload schema';
commit;
