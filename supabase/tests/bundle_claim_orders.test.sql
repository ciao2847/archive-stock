begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth, storage, pg_temp;

select plan(30);

select has_table('public', 'bundle_claim_orders', 'bundle orders table exists');
select has_table(
  'public',
  'bundle_claim_order_images',
  'bundle order images table exists'
);
select has_table(
  'public',
  'bundle_claim_payments',
  'bundle payments table exists'
);
select ok(
  exists (
    select 1
    from storage.buckets
    where id = 'bundle-claim-screenshots'
      and public = false
      and file_size_limit = 8388608
  ),
  'screenshot bucket is private with an eight MB limit'
);

create temp table bundle_test_context as
select
  profile.id as user_id,
  profile.inventory_owner_id as owner_id,
  other_inventory.id as other_owner_id,
  gen_random_uuid() as request_id,
  gen_random_uuid() as second_request_id
from public.profiles profile
join public.inventory_databases inventory
  on inventory.id = profile.inventory_owner_id
cross join lateral (
  select candidate.id
  from public.inventory_databases candidate
  where candidate.id <> profile.inventory_owner_id
  order by candidate.created_at, candidate.id
  limit 1
) other_inventory
where profile.role = 'staff'
limit 1;

do $fixture$
begin
  if not exists (select 1 from pg_temp.bundle_test_context) then
    raise exception 'bundle SQL tests require at least one staff inventory member';
  end if;
end;
$fixture$;

grant select, insert, update, delete on pg_temp.bundle_test_context
  to authenticated, service_role;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  (select user_id::text from pg_temp.bundle_test_context),
  true
);
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', (select user_id::text from pg_temp.bundle_test_context),
    'role', 'authenticated'
  )::text,
  true
);

create temp table bundle_test_order as
select *
from public.create_bundle_claim_order(
  (select owner_id from pg_temp.bundle_test_context),
  'Bundle SQL fixture',
  'Screenshot-backed fixed total',
  1200,
  'Thread nickname',
  now() + interval '1 day'
);
grant select on pg_temp.bundle_test_order to authenticated, service_role;

select is(
  (select count(*)::integer from pg_temp.bundle_test_order),
  1,
  'authorized inventory member creates one draft'
);

select throws_ok(
  format(
    'select * from public.create_bundle_claim_order(%L::uuid, %L, %L, 1200, %L, null)',
    (select other_owner_id from pg_temp.bundle_test_context),
    'Wrong inventory',
    '',
    ''
  ),
  'P0001',
  'owner access required',
  'cross-inventory create is rejected'
);

select lives_ok(
  format(
    'select * from public.add_bundle_claim_order_image(%L::uuid, %s, %L, %L, %L, 1024)',
    (select owner_id from pg_temp.bundle_test_context),
    (select order_id from pg_temp.bundle_test_order),
    format(
      '%s/%s/00000000-0000-4000-8000-000000000010.jpg',
      (select owner_id from pg_temp.bundle_test_context),
      (select order_id from pg_temp.bundle_test_order)
    ),
    'image/jpeg',
    'thread.jpg'
  ),
  'draft image metadata can be attached'
);

select lives_ok(
  format(
    'select public.open_bundle_claim_order(%L::uuid, %s)',
    (select owner_id from pg_temp.bundle_test_context),
    (select order_id from pg_temp.bundle_test_order)
  ),
  'draft with evidence can be opened'
);

select throws_ok(
  format(
    'select public.update_bundle_claim_order_draft(%L::uuid, %s, %L, %L, 900, %L, null)',
    (select owner_id from pg_temp.bundle_test_context),
    (select order_id from pg_temp.bundle_test_order),
    'Changed after open',
    '',
    ''
  ),
  'P0001',
  'bundle claim draft not found',
  'opened evidence and total are immutable'
);

select throws_ok(
  format(
    'select public.open_bundle_claim_order(%L::uuid, %s)',
    (select owner_id from pg_temp.bundle_test_context),
    (select order_id from pg_temp.bundle_test_order)
  ),
  'P0001',
  'bundle claim cannot be opened',
  'open transition cannot be repeated'
);

reset role;
set local role service_role;

create temp table bundle_first_confirmation as
select *
from public.confirm_bundle_claim_order(
  (select public_token from pg_temp.bundle_test_order),
  'Bundle buyer',
  '0912345678',
  'Full payment only',
  (select request_id from pg_temp.bundle_test_context)
);
grant select on pg_temp.bundle_first_confirmation to service_role, authenticated;

select is(
  (
    select status
    from public.bundle_claim_orders
    where id = (select order_id from pg_temp.bundle_test_order)
  ),
  'confirmed',
  'customer confirmation atomically changes state'
);

select is(
  (
    select confirmation_code
    from public.confirm_bundle_claim_order(
      (select public_token from pg_temp.bundle_test_order),
      'Race loser',
      '0999999999',
      '',
      (select second_request_id from pg_temp.bundle_test_context)
    )
  ),
  (select confirmation_code from pg_temp.bundle_first_confirmation),
  'a concurrent loser follows the locked idempotent confirmation path'
);

select is(
  (
    select customer_nickname
    from public.bundle_claim_orders
    where id = (select order_id from pg_temp.bundle_test_order)
  ),
  'Bundle buyer',
  'repeat confirmation cannot replace the winning customer'
);

reset role;
set local role authenticated;

select throws_ok(
  format(
    'select * from public.record_bundle_claim_payment(%L::uuid, %s, 600, now(), %L, %L)',
    (select owner_id from pg_temp.bundle_test_context),
    (select order_id from pg_temp.bundle_test_order),
    '',
    ''
  ),
  'P0001',
  'bundle claim requires full payment',
  'partial payment is rejected'
);

select lives_ok(
  format(
    'select * from public.record_bundle_claim_payment(%L::uuid, %s, 1200, now(), %L, %L)',
    (select owner_id from pg_temp.bundle_test_context),
    (select order_id from pg_temp.bundle_test_order),
    '12345',
    'verified'
  ),
  'exact full payment is recorded'
);

select throws_ok(
  format(
    'select * from public.record_bundle_claim_payment(%L::uuid, %s, 1200, now(), %L, %L)',
    (select owner_id from pg_temp.bundle_test_context),
    (select order_id from pg_temp.bundle_test_order),
    '',
    ''
  ),
  'P0001',
  'bundle claim is already paid',
  'one-to-one payment cannot be duplicated'
);

select throws_ok(
  format(
    'select public.set_bundle_claim_outbound_check(%L::uuid, %s, true)',
    (select owner_id from pg_temp.bundle_test_context),
    (select order_id from pg_temp.bundle_test_order)
  ),
  'P0001',
  'bundle claim outbound check is not available',
  'outbound check requires receiving first'
);

select lives_ok(
  format(
    'select public.set_bundle_claim_receiving_check(%L::uuid, %s, true)',
    (select owner_id from pg_temp.bundle_test_context),
    (select order_id from pg_temp.bundle_test_order)
  ),
  'receiving check is recorded'
);

select lives_ok(
  format(
    'select public.set_bundle_claim_outbound_check(%L::uuid, %s, true)',
    (select owner_id from pg_temp.bundle_test_context),
    (select order_id from pg_temp.bundle_test_order)
  ),
  'outbound check is recorded after receiving'
);

select lives_ok(
  format(
    'select public.set_bundle_claim_receiving_check(%L::uuid, %s, false)',
    (select owner_id from pg_temp.bundle_test_context),
    (select order_id from pg_temp.bundle_test_order)
  ),
  'receiving reversal is allowed'
);

select ok(
  (
    select receiving_checked_at is null and outbound_checked_at is null
    from public.bundle_claim_orders
    where id = (select order_id from pg_temp.bundle_test_order)
  ),
  'reversing receiving also clears outbound'
);

select lives_ok(
  format(
    'select public.delete_bundle_claim_payment(%L::uuid, %s)',
    (select owner_id from pg_temp.bundle_test_context),
    (select order_id from pg_temp.bundle_test_order)
  ),
  'full payment can be reversed'
);

select throws_ok(
  format(
    'select public.delete_bundle_claim_order_draft(%L::uuid, %s)',
    (select owner_id from pg_temp.bundle_test_context),
    (select order_id from pg_temp.bundle_test_order)
  ),
  'P0001',
  'bundle claim draft not found',
  'legacy draft-only RPC rejects confirmed orders'
);

select is(
  (
    select count(*)::integer
    from public.bundle_claim_orders
    where owner_id = (select other_owner_id from pg_temp.bundle_test_context)
  ),
  0,
  'RLS hides another inventory from a staff member'
);

reset role;
set local role anon;

select throws_ok(
  'select count(*) from public.bundle_claim_orders',
  '42501',
  null,
  'anonymous users cannot read bundle tables directly'
);

reset role;
set local role service_role;

select is(
  (
    public.query_customer_claims_summary(
      '0912345678',
      (select owner_id from pg_temp.bundle_test_context)
    )->>'found'
  )::boolean,
  true,
  'inventory-scoped settlement lookup includes a confirmed bundle claim'
);

select ok(
  exists (
    select 1
    from jsonb_array_elements(
      public.query_customer_claims_summary(
        '0912345678',
        (select owner_id from pg_temp.bundle_test_context)
      )->'submissions'
    ) submission
    where submission->>'source_type' = 'bundle'
      and submission->>'description' = 'Screenshot-backed fixed total'
  ),
  'LINE lookup includes the bundle customer-facing description'
);

select ok(
  exists (
    select 1
    from jsonb_array_elements(
      public.query_customer_claims_summary(
        '0912345678',
        (select owner_id from pg_temp.bundle_test_context)
      )->'submissions'
    ) submission
    where submission->>'source_type' = 'bundle'
      and coalesce(submission->>'confirmation_code', '') like 'HD-%'
  ),
  'LINE lookup includes the bundle confirmation number'
);

select ok(
  coalesce(
    not (
      public.query_customer_claims_summary(
        '0912345678',
        (select owner_id from pg_temp.bundle_test_context)
      )->'transfer_account'
    ) ? 'account_name',
    true
  ),
  'settlement lookup never exposes the transfer account holder'
);

select is(
  (
    public.query_customer_claims_summary(
      '0912345678',
      (select other_owner_id from pg_temp.bundle_test_context)
    )->>'found'
  )::boolean,
  false,
  'the same phone lookup does not cross inventory boundaries'
);

select * from finish();

rollback;
