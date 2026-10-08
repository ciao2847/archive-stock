-- SQL Editor: run this entire file as ONE statement.
-- The final exception intentionally rolls back all test data and shows the report.
do $bundle_editor$
declare
  v_row record;
  v_report text := '';
  v_line text;
  v_statement text;
  v_error text;
  v_context text;
begin
  begin
    v_statement := $statement_0$create extension if not exists pgtap with schema extensions$statement_0$;
    execute v_statement;
    v_statement := $statement_1$set local search_path = extensions, public, auth, storage, pg_temp$statement_1$;
    execute v_statement;
    v_statement := $statement_2$select plan(30)$statement_2$;
    for v_row in execute v_statement loop
      select string_agg(value, E'\n') into v_line
      from jsonb_each_text(to_jsonb(v_row));
      v_report := v_report || coalesce(v_line, '') || E'\n';
    end loop;
    v_statement := $statement_3$select has_table('public', 'bundle_claim_orders', 'bundle orders table exists')$statement_3$;
    for v_row in execute v_statement loop
      select string_agg(value, E'\n') into v_line
      from jsonb_each_text(to_jsonb(v_row));
      v_report := v_report || coalesce(v_line, '') || E'\n';
    end loop;
    v_statement := $statement_4$select has_table(
  'public',
  'bundle_claim_order_images',
  'bundle order images table exists'
)$statement_4$;
    for v_row in execute v_statement loop
      select string_agg(value, E'\n') into v_line
      from jsonb_each_text(to_jsonb(v_row));
      v_report := v_report || coalesce(v_line, '') || E'\n';
    end loop;
    v_statement := $statement_5$select has_table(
  'public',
  'bundle_claim_payments',
  'bundle payments table exists'
)$statement_5$;
    for v_row in execute v_statement loop
      select string_agg(value, E'\n') into v_line
      from jsonb_each_text(to_jsonb(v_row));
      v_report := v_report || coalesce(v_line, '') || E'\n';
    end loop;
    v_statement := $statement_6$select ok(
  exists (
    select 1
    from storage.buckets
    where id = 'bundle-claim-screenshots'
      and public = false
      and file_size_limit = 8388608
  ),
  'screenshot bucket is private with an eight MB limit'
)$statement_6$;
    for v_row in execute v_statement loop
      select string_agg(value, E'\n') into v_line
      from jsonb_each_text(to_jsonb(v_row));
      v_report := v_report || coalesce(v_line, '') || E'\n';
    end loop;
    v_statement := $statement_7$create temp table bundle_test_context as
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
limit 1$statement_7$;
    execute v_statement;
    v_statement := $statement_8$do $fixture$
begin
  if not exists (select 1 from pg_temp.bundle_test_context) then
    raise exception 'bundle SQL tests require at least one staff inventory member';
  end if;
end;
$fixture$$statement_8$;
    execute v_statement;
    v_statement := $statement_9$grant select, insert, update, delete on pg_temp.bundle_test_context
  to authenticated, service_role$statement_9$;
    execute v_statement;
    v_statement := $statement_10$set local role authenticated$statement_10$;
    execute v_statement;
    v_statement := $statement_11$select set_config(
  'request.jwt.claim.sub',
  (select user_id::text from pg_temp.bundle_test_context),
  true
)$statement_11$;
    execute v_statement;
    v_statement := $statement_12$select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', (select user_id::text from pg_temp.bundle_test_context),
    'role', 'authenticated'
  )::text,
  true
)$statement_12$;
    execute v_statement;
    v_statement := $statement_13$create temp table bundle_test_order as
select *
from public.create_bundle_claim_order(
  (select owner_id from pg_temp.bundle_test_context),
  'Bundle SQL fixture',
  'Screenshot-backed fixed total',
  1200,
  'Thread nickname',
  now() + interval '1 day'
)$statement_13$;
    execute v_statement;
    v_statement := $statement_14$grant select on pg_temp.bundle_test_order to authenticated, service_role$statement_14$;
    execute v_statement;
    v_statement := $statement_15$select is(
  (select count(*)::integer from pg_temp.bundle_test_order),
  1,
  'authorized inventory member creates one draft'
)$statement_15$;
    for v_row in execute v_statement loop
      select string_agg(value, E'\n') into v_line
      from jsonb_each_text(to_jsonb(v_row));
      v_report := v_report || coalesce(v_line, '') || E'\n';
    end loop;
    v_statement := $statement_16$select throws_ok(
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
)$statement_16$;
    for v_row in execute v_statement loop
      select string_agg(value, E'\n') into v_line
      from jsonb_each_text(to_jsonb(v_row));
      v_report := v_report || coalesce(v_line, '') || E'\n';
    end loop;
    v_statement := $statement_17$select lives_ok(
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
)$statement_17$;
    for v_row in execute v_statement loop
      select string_agg(value, E'\n') into v_line
      from jsonb_each_text(to_jsonb(v_row));
      v_report := v_report || coalesce(v_line, '') || E'\n';
    end loop;
    v_statement := $statement_18$select lives_ok(
  format(
    'select public.open_bundle_claim_order(%L::uuid, %s)',
    (select owner_id from pg_temp.bundle_test_context),
    (select order_id from pg_temp.bundle_test_order)
  ),
  'draft with evidence can be opened'
)$statement_18$;
    for v_row in execute v_statement loop
      select string_agg(value, E'\n') into v_line
      from jsonb_each_text(to_jsonb(v_row));
      v_report := v_report || coalesce(v_line, '') || E'\n';
    end loop;
    v_statement := $statement_19$select throws_ok(
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
)$statement_19$;
    for v_row in execute v_statement loop
      select string_agg(value, E'\n') into v_line
      from jsonb_each_text(to_jsonb(v_row));
      v_report := v_report || coalesce(v_line, '') || E'\n';
    end loop;
    v_statement := $statement_20$select throws_ok(
  format(
    'select public.open_bundle_claim_order(%L::uuid, %s)',
    (select owner_id from pg_temp.bundle_test_context),
    (select order_id from pg_temp.bundle_test_order)
  ),
  'P0001',
  'bundle claim cannot be opened',
  'open transition cannot be repeated'
)$statement_20$;
    for v_row in execute v_statement loop
      select string_agg(value, E'\n') into v_line
      from jsonb_each_text(to_jsonb(v_row));
      v_report := v_report || coalesce(v_line, '') || E'\n';
    end loop;
    v_statement := $statement_21$reset role$statement_21$;
    execute v_statement;
    v_statement := $statement_22$set local role service_role$statement_22$;
    execute v_statement;
    v_statement := $statement_23$create temp table bundle_first_confirmation as
select *
from public.confirm_bundle_claim_order(
  (select public_token from pg_temp.bundle_test_order),
  'Bundle buyer',
  '0912345678',
  'Full payment only',
  (select request_id from pg_temp.bundle_test_context)
)$statement_23$;
    execute v_statement;
    v_statement := $statement_24$grant select on pg_temp.bundle_first_confirmation to service_role, authenticated$statement_24$;
    execute v_statement;
    v_statement := $statement_25$select is(
  (
    select status
    from public.bundle_claim_orders
    where id = (select order_id from pg_temp.bundle_test_order)
  ),
  'confirmed',
  'customer confirmation atomically changes state'
)$statement_25$;
    for v_row in execute v_statement loop
      select string_agg(value, E'\n') into v_line
      from jsonb_each_text(to_jsonb(v_row));
      v_report := v_report || coalesce(v_line, '') || E'\n';
    end loop;
    v_statement := $statement_26$select is(
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
)$statement_26$;
    for v_row in execute v_statement loop
      select string_agg(value, E'\n') into v_line
      from jsonb_each_text(to_jsonb(v_row));
      v_report := v_report || coalesce(v_line, '') || E'\n';
    end loop;
    v_statement := $statement_27$select is(
  (
    select customer_nickname
    from public.bundle_claim_orders
    where id = (select order_id from pg_temp.bundle_test_order)
  ),
  'Bundle buyer',
  'repeat confirmation cannot replace the winning customer'
)$statement_27$;
    for v_row in execute v_statement loop
      select string_agg(value, E'\n') into v_line
      from jsonb_each_text(to_jsonb(v_row));
      v_report := v_report || coalesce(v_line, '') || E'\n';
    end loop;
    v_statement := $statement_28$reset role$statement_28$;
    execute v_statement;
    v_statement := $statement_29$set local role authenticated$statement_29$;
    execute v_statement;
    v_statement := $statement_30$select throws_ok(
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
)$statement_30$;
    for v_row in execute v_statement loop
      select string_agg(value, E'\n') into v_line
      from jsonb_each_text(to_jsonb(v_row));
      v_report := v_report || coalesce(v_line, '') || E'\n';
    end loop;
    v_statement := $statement_31$select lives_ok(
  format(
    'select * from public.record_bundle_claim_payment(%L::uuid, %s, 1200, now(), %L, %L)',
    (select owner_id from pg_temp.bundle_test_context),
    (select order_id from pg_temp.bundle_test_order),
    '12345',
    'verified'
  ),
  'exact full payment is recorded'
)$statement_31$;
    for v_row in execute v_statement loop
      select string_agg(value, E'\n') into v_line
      from jsonb_each_text(to_jsonb(v_row));
      v_report := v_report || coalesce(v_line, '') || E'\n';
    end loop;
    v_statement := $statement_32$select throws_ok(
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
)$statement_32$;
    for v_row in execute v_statement loop
      select string_agg(value, E'\n') into v_line
      from jsonb_each_text(to_jsonb(v_row));
      v_report := v_report || coalesce(v_line, '') || E'\n';
    end loop;
    v_statement := $statement_33$select throws_ok(
  format(
    'select public.set_bundle_claim_outbound_check(%L::uuid, %s, true)',
    (select owner_id from pg_temp.bundle_test_context),
    (select order_id from pg_temp.bundle_test_order)
  ),
  'P0001',
  'bundle claim outbound check is not available',
  'outbound check requires receiving first'
)$statement_33$;
    for v_row in execute v_statement loop
      select string_agg(value, E'\n') into v_line
      from jsonb_each_text(to_jsonb(v_row));
      v_report := v_report || coalesce(v_line, '') || E'\n';
    end loop;
    v_statement := $statement_34$select lives_ok(
  format(
    'select public.set_bundle_claim_receiving_check(%L::uuid, %s, true)',
    (select owner_id from pg_temp.bundle_test_context),
    (select order_id from pg_temp.bundle_test_order)
  ),
  'receiving check is recorded'
)$statement_34$;
    for v_row in execute v_statement loop
      select string_agg(value, E'\n') into v_line
      from jsonb_each_text(to_jsonb(v_row));
      v_report := v_report || coalesce(v_line, '') || E'\n';
    end loop;
    v_statement := $statement_35$select lives_ok(
  format(
    'select public.set_bundle_claim_outbound_check(%L::uuid, %s, true)',
    (select owner_id from pg_temp.bundle_test_context),
    (select order_id from pg_temp.bundle_test_order)
  ),
  'outbound check is recorded after receiving'
)$statement_35$;
    for v_row in execute v_statement loop
      select string_agg(value, E'\n') into v_line
      from jsonb_each_text(to_jsonb(v_row));
      v_report := v_report || coalesce(v_line, '') || E'\n';
    end loop;
    v_statement := $statement_36$select lives_ok(
  format(
    'select public.set_bundle_claim_receiving_check(%L::uuid, %s, false)',
    (select owner_id from pg_temp.bundle_test_context),
    (select order_id from pg_temp.bundle_test_order)
  ),
  'receiving reversal is allowed'
)$statement_36$;
    for v_row in execute v_statement loop
      select string_agg(value, E'\n') into v_line
      from jsonb_each_text(to_jsonb(v_row));
      v_report := v_report || coalesce(v_line, '') || E'\n';
    end loop;
    v_statement := $statement_37$select ok(
  (
    select receiving_checked_at is null and outbound_checked_at is null
    from public.bundle_claim_orders
    where id = (select order_id from pg_temp.bundle_test_order)
  ),
  'reversing receiving also clears outbound'
)$statement_37$;
    for v_row in execute v_statement loop
      select string_agg(value, E'\n') into v_line
      from jsonb_each_text(to_jsonb(v_row));
      v_report := v_report || coalesce(v_line, '') || E'\n';
    end loop;
    v_statement := $statement_38$select lives_ok(
  format(
    'select public.delete_bundle_claim_payment(%L::uuid, %s)',
    (select owner_id from pg_temp.bundle_test_context),
    (select order_id from pg_temp.bundle_test_order)
  ),
  'full payment can be reversed'
)$statement_38$;
    for v_row in execute v_statement loop
      select string_agg(value, E'\n') into v_line
      from jsonb_each_text(to_jsonb(v_row));
      v_report := v_report || coalesce(v_line, '') || E'\n';
    end loop;
    v_statement := $statement_39$select throws_ok(
  format(
    'select public.delete_bundle_claim_order_draft(%L::uuid, %s)',
    (select owner_id from pg_temp.bundle_test_context),
    (select order_id from pg_temp.bundle_test_order)
  ),
  'P0001',
  'bundle claim draft not found',
  'confirmed orders cannot be deleted'
)$statement_39$;
    for v_row in execute v_statement loop
      select string_agg(value, E'\n') into v_line
      from jsonb_each_text(to_jsonb(v_row));
      v_report := v_report || coalesce(v_line, '') || E'\n';
    end loop;
    v_statement := $statement_40$select is(
  (
    select count(*)::integer
    from public.bundle_claim_orders
    where owner_id = (select other_owner_id from pg_temp.bundle_test_context)
  ),
  0,
  'RLS hides another inventory from a staff member'
)$statement_40$;
    for v_row in execute v_statement loop
      select string_agg(value, E'\n') into v_line
      from jsonb_each_text(to_jsonb(v_row));
      v_report := v_report || coalesce(v_line, '') || E'\n';
    end loop;
    v_statement := $statement_41$reset role$statement_41$;
    execute v_statement;
    v_statement := $statement_42$set local role anon$statement_42$;
    execute v_statement;
    v_statement := $statement_43$select throws_ok(
  'select count(*) from public.bundle_claim_orders',
  '42501',
  null,
  'anonymous users cannot read bundle tables directly'
)$statement_43$;
    for v_row in execute v_statement loop
      select string_agg(value, E'\n') into v_line
      from jsonb_each_text(to_jsonb(v_row));
      v_report := v_report || coalesce(v_line, '') || E'\n';
    end loop;
    v_statement := $statement_44$reset role$statement_44$;
    execute v_statement;
    v_statement := $statement_45$set local role service_role$statement_45$;
    execute v_statement;
    v_statement := $statement_46$select is(
  (
    public.query_customer_claims_summary(
      '0912345678',
      (select owner_id from pg_temp.bundle_test_context)
    )->>'found'
  )::boolean,
  true,
  'inventory-scoped settlement lookup includes a confirmed bundle claim'
)$statement_46$;
    for v_row in execute v_statement loop
      select string_agg(value, E'\n') into v_line
      from jsonb_each_text(to_jsonb(v_row));
      v_report := v_report || coalesce(v_line, '') || E'\n';
    end loop;
    v_statement := $statement_47$select ok(
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
)$statement_47$;
    for v_row in execute v_statement loop
      select string_agg(value, E'\n') into v_line
      from jsonb_each_text(to_jsonb(v_row));
      v_report := v_report || coalesce(v_line, '') || E'\n';
    end loop;
    v_statement := $statement_48$select ok(
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
)$statement_48$;
    for v_row in execute v_statement loop
      select string_agg(value, E'\n') into v_line
      from jsonb_each_text(to_jsonb(v_row));
      v_report := v_report || coalesce(v_line, '') || E'\n';
    end loop;
    v_statement := $statement_49$select ok(
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
)$statement_49$;
    for v_row in execute v_statement loop
      select string_agg(value, E'\n') into v_line
      from jsonb_each_text(to_jsonb(v_row));
      v_report := v_report || coalesce(v_line, '') || E'\n';
    end loop;
    v_statement := $statement_50$select is(
  (
    public.query_customer_claims_summary(
      '0912345678',
      (select other_owner_id from pg_temp.bundle_test_context)
    )->>'found'
  )::boolean,
  false,
  'the same phone lookup does not cross inventory boundaries'
)$statement_50$;
    for v_row in execute v_statement loop
      select string_agg(value, E'\n') into v_line
      from jsonb_each_text(to_jsonb(v_row));
      v_report := v_report || coalesce(v_line, '') || E'\n';
    end loop;
    v_statement := $statement_51$select * from finish()$statement_51$;
    for v_row in execute v_statement loop
      select string_agg(value, E'\n') into v_line
      from jsonb_each_text(to_jsonb(v_row));
      v_report := v_report || coalesce(v_line, '') || E'\n';
    end loop;
  exception when others then
    get stacked diagnostics v_error = message_text, v_context = pg_exception_context;
    v_report := v_report || E'\nExecution error: ' || v_error
      || E'\nStatement: ' || v_statement || E'\nContext: ' || v_context;
  end;
  raise exception using message = E'TEST REPORT (intentional rollback)\n' || v_report;
end;
$bundle_editor$;
