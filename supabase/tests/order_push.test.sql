begin;
-- Entire verification rolls back; no real push messages are sent.
create temp table push_test_context as
select p.id user_id,p.inventory_owner_id owner_id,f.id form_id,
  other.id other_owner_id,(select id from public.profiles where role='admin' limit 1) admin_id,
  gen_random_uuid() staff_device,gen_random_uuid() admin_device,
  null::bigint claim_id,null::bigint bundle_id
from public.profiles p join public.claim_forms f on f.owner_id=p.inventory_owner_id
join public.inventory_databases other on other.id<>p.inventory_owner_id
where p.role='staff' limit 1;
do $$ begin if not exists(select 1 from push_test_context where admin_id is not null) then raise exception 'Push tests need a staff member, admin, form and two inventories';end if;end $$;
grant select on push_test_context to authenticated,service_role;
set local role authenticated;
select set_config('request.jwt.claim.sub',(select user_id::text from push_test_context),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',(select user_id from push_test_context),'role','authenticated')::text,true);
insert into public.web_push_subscriptions(id,endpoint,p256dh,auth_key,inventory_ids)
select staff_device,'https://web.push.apple.com/test-'||staff_device,repeat('B',87),repeat('A',22),array[owner_id] from push_test_context;
do $$ declare c record; begin
 select * into c from push_test_context;
 begin
   insert into public.web_push_subscriptions(endpoint,p256dh,auth_key,inventory_ids)
   values('https://web.push.apple.com/forbidden',repeat('B',87),repeat('A',22),array[c.other_owner_id]);
   raise exception 'Cross inventory subscription allowed';
 exception when insufficient_privilege then null;end;
 if has_function_privilege('authenticated','public.claim_order_push_deliveries(integer)','execute') then raise exception 'Staff can claim delivery credentials';end if;
 if has_function_privilege('anon','public.claim_order_push_deliveries(integer)','execute') then raise exception 'Anonymous can claim delivery credentials';end if;
end $$;
reset role;
insert into public.web_push_subscriptions(id,user_id,endpoint,p256dh,auth_key,inventory_ids)
select admin_device,admin_id,'https://web.push.apple.com/test-'||admin_device,repeat('B',87),repeat('A',22),array[owner_id,other_owner_id] from push_test_context;
with inserted as (
 insert into public.claim_submissions(form_id,request_id,nickname,phone,phone_normalized)
 select form_id,gen_random_uuid(),'Notification test','0999999999','0999999999' from push_test_context returning id
) update push_test_context set claim_id=inserted.id from inserted;
with inserted as (
 insert into public.bundle_claim_orders(owner_id,title,total_amount,status)
 select owner_id,'Push bundle fixture',100,'draft' from push_test_context returning id
) update push_test_context set bundle_id=inserted.id from inserted;
do $$ declare c record; begin
 select * into c from push_test_context;
 if (select count(*) from public.order_push_events where kind='claim' and source_id=c.claim_id)<>1 then raise exception 'Claim event not recorded';end if;
 if (select count(*) from public.order_push_deliveries d join public.order_push_events e on e.id=d.event_id where e.kind='claim' and e.source_id=c.claim_id)<>2 then raise exception 'Wrong notification recipients';end if;
 if exists(select 1 from public.order_push_events where kind='bundle' and source_id=c.bundle_id)then raise exception 'Draft bundle created push';end if;
end $$;
update public.bundle_claim_orders set status='confirmed',customer_nickname='Fixture',customer_phone='0999999999',customer_phone_normalized='0999999999',confirmed_at=now(),confirmation_request_id=gen_random_uuid() where id=(select bundle_id from push_test_context);
update public.bundle_claim_orders set status='confirmed' where id=(select bundle_id from push_test_context);
do $$ begin
 if (select count(*) from public.order_push_events where kind='bundle' and source_id=(select bundle_id from push_test_context))<>1 then raise exception 'Bundle event duplicate';end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',(select user_id::text from push_test_context),true);
do $$ begin
 if (select count(*) from public.web_push_subscriptions)<>1 then raise exception 'Another user device exposed';end if;
 if (select count(*) from public.order_push_events where source_id in (select claim_id from push_test_context union select bundle_id from push_test_context))<2 then raise exception 'Own notification hidden';end if;
end $$;
reset role;
-- Membership changed after enqueue: stale device must not receive queued work.
update public.profiles set inventory_owner_id=(select other_owner_id from push_test_context) where id=(select user_id from push_test_context);
set local role authenticated;
select set_config('request.jwt.claim.sub',(select user_id::text from push_test_context),true);
do $$ begin
 if exists(select 1 from public.order_push_events where inventory_id=(select owner_id from push_test_context)) then raise exception 'Former member can read notification';end if;
end $$;
reset role;
set local role service_role;
do $$ declare jobs record; retry_job record; n integer:=0; another integer; begin
 for jobs in select * from public.claim_order_push_deliveries(30) loop
   if jobs.endpoint not like 'https://web.push.apple.com/test-%' then raise exception 'Unexpected real subscriber';end if;
   if jobs.endpoint like '%'||(select staff_device::text from push_test_context) then raise exception 'Former member received notification';end if;
   n:=n+1;
   perform public.finish_order_push_delivery(jobs.delivery_id,gen_random_uuid(),'sent');
   if (select status from public.order_push_deliveries where id=jobs.delivery_id)<>'pending' then raise exception 'Wrong lease acknowledged';end if;
   if n=1 then
     select count(*) into another from public.claim_order_push_deliveries(30);
     if another<>0 then raise exception 'Concurrent worker reclaimed active lease';end if;
     perform public.finish_order_push_delivery(jobs.delivery_id,jobs.lease_token,'retry','PUSH_HTTP_503');
     if not exists(select 1 from public.order_push_deliveries where id=jobs.delivery_id and status='pending' and available_at>now() and locked_until is null) then raise exception 'Retry backoff not scheduled';end if;
     update public.order_push_deliveries set available_at=now()-interval '1 second' where id=jobs.delivery_id;
     select * into retry_job from public.claim_order_push_deliveries(1);
     if retry_job.delivery_id<>jobs.delivery_id or retry_job.lease_token=jobs.lease_token then raise exception 'Retry lease not renewed';end if;
     perform public.finish_order_push_delivery(retry_job.delivery_id,retry_job.lease_token,'sent');
   else
     perform public.finish_order_push_delivery(jobs.delivery_id,jobs.lease_token,'sent');
   end if;
 end loop;
 if n<>2 then raise exception 'Expected two admin deliveries, got %',n;end if;
 select count(*) into another from public.claim_order_push_deliveries(30);
 if another<>0 then raise exception 'Duplicate delivery claimed';end if;
 if (select count(*) from public.order_push_deliveries where subscription_id=(select staff_device from push_test_context) and status='skipped')<>2 then raise exception 'Former member deliveries not skipped';end if;
end $$;
reset role;
select 'PASS: device RLS, inventory isolation, event deduplication, membership revocation and worker leases' as result;
rollback;
