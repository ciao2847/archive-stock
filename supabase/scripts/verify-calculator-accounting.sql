-- SQL Editor: run this WHOLE block as postgres, without selecting a fragment.
-- Success / No rows returned means all 42 checks passed. A NOTICE also reports the count.
-- All test data, temporary tables, helper functions and role changes roll back internally.
-- Requires calculator_period_accounting and poster_revenue_settlement, a staff member and two inventories.
do $accounting_editor$
declare
  v_statement text;
  v_passed integer := 0;
begin
  begin
    foreach v_statement in array array[
      $accounting_step_1$create temp table accounting_checks(label text)$accounting_step_1$,
      $accounting_step_2$create function pg_temp.assert_accounting(p_ok boolean, p_label text) returns void
language plpgsql as $$ begin
  if p_ok is distinct from true then raise exception 'Accounting check failed: %', p_label; end if;
  insert into pg_temp.accounting_checks values(p_label);
end $$$accounting_step_2$,
      $accounting_step_3$create function pg_temp.expect_accounting_failure(p_sql text, p_message text) returns void
language plpgsql as $$ declare v_error text; begin
  begin execute p_sql; exception when others then v_error := sqlerrm; end;
  perform pg_temp.assert_accounting(v_error is not null and position(p_message in v_error) > 0,
    'Rejected: ' || p_message);
end $$$accounting_step_3$,
      $accounting_step_4$create temp table accounting_context as
select p.id as user_id, p.inventory_owner_id as owner_id,
  other_inventory.id as other_owner_id,
  gen_random_uuid() as product_id, gen_random_uuid() as order_id,
  gen_random_uuid() as boundary_order_id, gen_random_uuid() as pending_order_id,
  gen_random_uuid() as deleted_order_id,
  p.inventory_owner_id::text || '/' || p.id::text || '/' || gen_random_uuid()::text || '.webp' as calculator_path,
  p.inventory_owner_id::text || '/' || p.id::text || '/' || gen_random_uuid()::text || '.webp' as evidence_path
from public.profiles p cross join lateral (
  select id from public.inventory_databases where id <> p.inventory_owner_id order by id limit 1
) other_inventory where p.role = 'staff' limit 1$accounting_step_4$,
      $accounting_step_5$do $$ begin
  if not exists(select 1 from pg_temp.accounting_context) then
    raise exception 'Requires a staff inventory member and a second inventory'; end if;
  if exists(select 1 from public.financial_period_costs where owner_id=(select owner_id from pg_temp.accounting_context)
    and period_start between '2096-01-01' and '2096-04-30') then
    raise exception 'Fixture periods already exist; select a different fixture year'; end if;
end $$$accounting_step_5$,
      $accounting_step_6$grant select on pg_temp.accounting_context to authenticated, anon$accounting_step_6$,
      $accounting_step_7$grant select, insert on pg_temp.accounting_checks to authenticated, anon$accounting_step_7$,
      $accounting_step_8$-- Fixtures are created as postgres; runtime operations below use actual staff RLS.
insert into public.products(id, owner_id, name, category, stock, price, cost, created_by)
select product_id, owner_id, 'Accounting fixture', '海報', 1, 1000, 99999, user_id from pg_temp.accounting_context$accounting_step_8$,
      $accounting_step_9$insert into public.orders(id, owner_id, status, packed_at, created_at, shipping_income,
  discount, platform_fee, seller_shipping_cost, created_by)
select order_id, owner_id, 'packed'::public.order_status, '2096-02-29T15:59:59Z'::timestamptz, '2096-01-01T00:00:00Z'::timestamptz, 60, 100, 900, 800, user_id from pg_temp.accounting_context
union all select boundary_order_id, owner_id, 'packed'::public.order_status, '2096-02-29T16:00:00Z'::timestamptz, '2096-01-01T00:00:00Z'::timestamptz, 0, 0, 0, 0, user_id from pg_temp.accounting_context
union all select pending_order_id, owner_id, 'pending'::public.order_status, null, '2096-01-01T00:00:00Z'::timestamptz, 0, 0, 0, 0, user_id from pg_temp.accounting_context
union all select deleted_order_id, owner_id, 'packed'::public.order_status, '2096-02-01T00:00:00Z'::timestamptz, '2096-01-01T00:00:00Z'::timestamptz, 0, 0, 0, 0, user_id from pg_temp.accounting_context$accounting_step_9$,
      $accounting_step_10$update public.orders set deleted_at=now() where id=(select deleted_order_id from pg_temp.accounting_context)$accounting_step_10$,
      $accounting_step_11$insert into public.order_items(order_id, product_id, quantity, unit_price)
select order_id, product_id, 2, 1000 from pg_temp.accounting_context
union all select boundary_order_id, product_id, 1, 500 from pg_temp.accounting_context
union all select pending_order_id, product_id, 1, 700 from pg_temp.accounting_context
union all select deleted_order_id, product_id, 1, 800 from pg_temp.accounting_context$accounting_step_11$,
      $accounting_step_12$insert into storage.objects(bucket_id, name)
select 'finance-images', calculator_path from pg_temp.accounting_context
union all select 'finance-images', evidence_path from pg_temp.accounting_context$accounting_step_12$,
      $accounting_step_13$-- Verify DELETE RLS on an isolated copy, without issuing DELETE against Storage.
-- Copy every applicable policy so a broad permissive policy is detected too.
-- Keep the table name "objects": correlated policy expressions can qualify it.
create temp table objects (like storage.objects including defaults)$accounting_step_13$,
      $accounting_step_14$insert into pg_temp.objects select * from storage.objects where bucket_id='finance-images'
  and name in (select calculator_path from pg_temp.accounting_context
    union select evidence_path from pg_temp.accounting_context)$accounting_step_14$,
      $accounting_step_15$insert into pg_temp.objects(bucket_id, name)
select 'finance-images', owner_id::text || '/' || user_id::text || '/' || gen_random_uuid()::text || '.webp'
from pg_temp.accounting_context$accounting_step_15$,
      $accounting_step_16$alter table pg_temp.objects enable row level security$accounting_step_16$,
      $accounting_step_17$grant select, delete on pg_temp.objects to authenticated$accounting_step_17$,
      $accounting_step_18$do $copy_storage_policies$
declare p record; v_roles text;
begin
  for p in select * from pg_policy
    where polrelid = 'storage.objects'::regclass and polcmd in ('r', 'd', '*')
  loop
    select string_agg(case when role_id=0 then 'public' else quote_ident(pg_get_userbyid(role_id)) end, ', ')
      into v_roles from unnest(p.polroles) role_id;
    execute format('create policy %I on pg_temp.objects as %s for %s to %s using (%s)',
      p.polname, case when p.polpermissive then 'permissive' else 'restrictive' end,
      case p.polcmd when 'r' then 'select' when 'd' then 'delete' else 'all' end,
      v_roles, coalesce(pg_get_expr(p.polqual, p.polrelid), 'true'));
  end loop;
end;
$copy_storage_policies$$accounting_step_18$,
      $accounting_step_19$-- Bucket configuration is a platform-level check, not a staff read-permission check.
-- With Storage RLS, authenticated can see no bucket rows even when it is private.
select pg_temp.assert_accounting((select public=false from storage.buckets where id='finance-images'), 'Finance image bucket is private')$accounting_step_19$,
      $accounting_step_20$set local role authenticated$accounting_step_20$,
      $accounting_step_21$select set_config('request.jwt.claim.sub', (select user_id::text from pg_temp.accounting_context), true)$accounting_step_21$,
      $accounting_step_22$select set_config('request.jwt.claims', jsonb_build_object('sub',(select user_id::text from pg_temp.accounting_context),'role','authenticated')::text, true)$accounting_step_22$,
      $accounting_step_23$select pg_temp.assert_accounting(
  (public.get_financial_period_preview((select owner_id from pg_temp.accounting_context),'2096-01-01','2096-02-29')->>'revenue')::numeric = 1900,
  'Poster revenue excludes buyer shipping and deducts discounts; costs apply once')$accounting_step_23$,
      $accounting_step_24$select pg_temp.assert_accounting(
  (public.get_financial_period_preview((select owner_id from pg_temp.accounting_context),'2096-01-01','2096-02-29')->>'order_count')::integer = 1,
  'Taiwan date boundary, pending and deleted orders are excluded')$accounting_step_24$,
      $accounting_step_25$select pg_temp.expect_accounting_failure(format('select public.create_financial_settlement(%L,''2096-01-01'',''2096-02-29'')',
  (select owner_id from pg_temp.accounting_context)), 'confirm period cost first')$accounting_step_25$,
      $accounting_step_26$select pg_temp.expect_accounting_failure(format('select public.get_financial_period_preview(%L,''2096-01-01'',''2096-02-29'')',
  (select other_owner_id from pg_temp.accounting_context)), 'owner access required')$accounting_step_26$,
      $accounting_step_27$select pg_temp.expect_accounting_failure(format('select public.confirm_financial_period_cost(%L,''2096-01-01'',''2096-02-29'',1,null,''{}'','''',0)',
  (select other_owner_id from pg_temp.accounting_context)), 'owner access required')$accounting_step_27$,
      $accounting_step_28$select pg_temp.expect_accounting_failure(format('select public.confirm_financial_period_cost(%L,''2096-01-01'',''2096-02-29'',-1,null,''{}'','''',0)',
  (select owner_id from pg_temp.accounting_context)), 'invalid period amount')$accounting_step_28$,
      $accounting_step_29$select pg_temp.expect_accounting_failure(format('select public.confirm_financial_period_cost(%L,''2096-01-01'',''2096-02-29'',1.001,null,''{}'','''',0)',
  (select owner_id from pg_temp.accounting_context)), 'invalid period amount')$accounting_step_29$,
      $accounting_step_30$select pg_temp.expect_accounting_failure(format('select public.confirm_financial_period_cost(%L,''2096-01-01'',''2096-02-29'',1,%L,''{}'','''',0)',
  (select owner_id from pg_temp.accounting_context), (select owner_id::text || '/' || user_id::text || '/' || gen_random_uuid()::text || '.webp' from pg_temp.accounting_context)), 'invalid finance image')$accounting_step_30$,
      $accounting_step_31$select public.confirm_financial_period_cost(owner_id,'2096-01-01','2096-02-29',100290,calculator_path,array[evidence_path],'購入總額',0)
from pg_temp.accounting_context$accounting_step_31$,
      $accounting_step_32$select pg_temp.assert_accounting((select amount=100290 and revision=1 from public.financial_period_costs
  where owner_id=(select owner_id from pg_temp.accounting_context) and period_start='2096-01-01'), 'Staff can confirm a period total')$accounting_step_32$,
      $accounting_step_33$select pg_temp.assert_accounting((select count(*)=0 from public.financial_period_costs
  where owner_id=(select other_owner_id from pg_temp.accounting_context)), 'Staff cannot read another inventory cost')$accounting_step_33$,
      $accounting_step_34$select pg_temp.assert_accounting((select count(*)=1 from public.financial_period_cost_revisions
  where cost_id=(select id from public.financial_period_costs where period_start='2096-01-01')), 'First confirmation is audited')$accounting_step_34$,
      $accounting_step_35$select pg_temp.expect_accounting_failure(format('select public.confirm_financial_period_cost(%L,''2096-01-01'',''2096-02-29'',200,null,''{}'','''',0)',
  (select owner_id from pg_temp.accounting_context)), 'period cost was changed; reload')$accounting_step_35$,
      $accounting_step_36$select public.confirm_financial_period_cost(owner_id,'2096-01-01','2096-02-29',110000,calculator_path,array[evidence_path],'更正總額',1)
from pg_temp.accounting_context$accounting_step_36$,
      $accounting_step_37$select pg_temp.assert_accounting((select amount=110000 and revision=2 from public.financial_period_costs
  where owner_id=(select owner_id from pg_temp.accounting_context) and period_start='2096-01-01'), 'Correction replaces total instead of adding it')$accounting_step_37$,
      $accounting_step_38$select pg_temp.assert_accounting((select count(*)=2 from public.financial_period_cost_revisions
  where cost_id=(select id from public.financial_period_costs where period_start='2096-01-01')), 'Previous amount/attachments retained as revisions')$accounting_step_38$,
      $accounting_step_39$select pg_temp.expect_accounting_failure(format('update public.financial_period_costs set owner_id=%L where period_start=''2096-01-01''',
  (select other_owner_id from pg_temp.accounting_context)), 'owner access required')$accounting_step_39$,
      $accounting_step_40$select pg_temp.expect_accounting_failure(format('select public.confirm_financial_period_cost(%L,''2096-01-01'',''2096-02-29'',1,%L,array[%L],'''',2)',
  (select owner_id from pg_temp.accounting_context), (select calculator_path from pg_temp.accounting_context),
  (select calculator_path from pg_temp.accounting_context)), 'duplicate finance image')$accounting_step_40$,
      $accounting_step_41$delete from pg_temp.objects where bucket_id='finance-images' and name in
  (select calculator_path from pg_temp.accounting_context union select evidence_path from pg_temp.accounting_context)$accounting_step_41$,
      $accounting_step_42$select pg_temp.assert_accounting((select count(*)=2 from pg_temp.objects where name in
  (select calculator_path from pg_temp.accounting_context union select evidence_path from pg_temp.accounting_context)), 'Storage DELETE policies protect saved calculator and evidence')$accounting_step_42$,
      $accounting_step_43$delete from pg_temp.objects where bucket_id='finance-images' and name not in
  (select calculator_path from pg_temp.accounting_context union select evidence_path from pg_temp.accounting_context)$accounting_step_43$,
      $accounting_step_44$select pg_temp.assert_accounting((select count(*)=2 from pg_temp.objects), 'Storage DELETE policies allow removal of unused uploads')$accounting_step_44$,
      $accounting_step_45$create temp table accounting_snapshot as
select s.* from pg_temp.accounting_context c cross join lateral public.create_financial_settlement(c.owner_id,'2096-01-01','2096-02-29') s$accounting_step_45$,
      $accounting_step_46$select pg_temp.assert_accounting((select revenue=1900 and cost=110000 and profit=-108100 and cost_source='period_total'
  from pg_temp.accounting_snapshot), 'Settlement uses the confirmed total regardless of product costs')$accounting_step_46$,
      $accounting_step_47$select pg_temp.assert_accounting((select count(*)=1 from public.settlement_orders where settlement_id=(select id from pg_temp.accounting_snapshot)), 'One eligible order is frozen')$accounting_step_47$,
      $accounting_step_48$select pg_temp.assert_accounting((select count(*)=0 from public.settlement_products where settlement_id=(select id from pg_temp.accounting_snapshot)), 'New settlement never consumes product costs')$accounting_step_48$,
      $accounting_step_49$select pg_temp.assert_accounting((public.get_financial_period_preview((select owner_id from pg_temp.accounting_context),'2096-01-01','2096-02-29')->>'settled')::boolean,
  'Preview reads the frozen snapshot after settlement')$accounting_step_49$,
      $accounting_step_50$select pg_temp.expect_accounting_failure(format('select public.create_financial_settlement(%L,''2096-01-01'',''2096-02-29'')',
  (select owner_id from pg_temp.accounting_context)), 'period already settled')$accounting_step_50$,
      $accounting_step_51$select pg_temp.expect_accounting_failure(format('select public.confirm_financial_period_cost(%L,''2096-01-01'',''2096-02-29'',120000,null,''{}'','''',2)',
  (select owner_id from pg_temp.accounting_context)), 'period already settled')$accounting_step_51$,
      $accounting_step_52$select pg_temp.expect_accounting_failure('select public.create_financial_settlement(null,''2096-01-01'',''2096-02-29'')', 'owner access required')$accounting_step_52$,
      $accounting_step_53$select pg_temp.expect_accounting_failure(format('select public.create_financial_settlement(%L,null,null)',
  (select owner_id from pg_temp.accounting_context)), 'invalid period dates')$accounting_step_53$,
      $accounting_step_54$select pg_temp.expect_accounting_failure(format('select public.create_financial_settlement(%L,''2096-01-01'',''2096-01-31'')',
  (select owner_id from pg_temp.accounting_context)), 'invalid period dates')$accounting_step_54$,
      $accounting_step_55$select pg_temp.expect_accounting_failure('insert into public.financial_period_cost_revisions(cost_id,revision) values(gen_random_uuid(),3)', 'permission denied')$accounting_step_55$,
      $accounting_step_56$select pg_temp.assert_accounting(not has_function_privilege('authenticated','public.get_admin_product_costs()','execute'), 'Legacy product cost reader retired')$accounting_step_56$,
      $accounting_step_57$select pg_temp.assert_accounting(not has_function_privilege('authenticated','public.set_admin_product_cost(uuid,numeric)','execute'), 'Legacy product cost writer retired')$accounting_step_57$,
      $accounting_step_58$select pg_temp.expect_accounting_failure('insert into public.settlements(owner_id,revenue,cost) values(gen_random_uuid(),999,0)', 'permission denied')$accounting_step_58$,
      $accounting_step_59$select pg_temp.expect_accounting_failure('insert into public.settlement_orders(settlement_id,order_id,revenue) values(gen_random_uuid(),gen_random_uuid(),999)', 'permission denied')$accounting_step_59$,
      $accounting_step_60$select pg_temp.assert_accounting(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='create_financial_settlement' and p.prosecdef), 'Public settlement API does not expose a definer function')$accounting_step_60$,
      $accounting_step_61$-- Zero costs are valid; do not carry previous-period costs into the next period.
select public.confirm_financial_period_cost(owner_id,'2096-03-01','2096-04-30',0,null,'{}','無購入支出',0) from pg_temp.accounting_context$accounting_step_61$,
      $accounting_step_62$select pg_temp.assert_accounting((public.create_financial_settlement((select owner_id from pg_temp.accounting_context), '2096-03-01','2096-04-30')).profit=500,
  'Next period has its own zero cost and Taiwan-boundary order')$accounting_step_62$,
      $accounting_step_63$-- All purchase spend is counted even when nothing has been sold.
select public.confirm_financial_period_cost(owner_id,'2096-05-01','2096-06-30',500,null,'{}','未售出購入',0) from pg_temp.accounting_context$accounting_step_63$,
      $accounting_step_64$select pg_temp.assert_accounting((public.create_financial_settlement((select owner_id from pg_temp.accounting_context), '2096-05-01','2096-06-30')).profit=-500,
  'Cost-only period can be settled without sales')$accounting_step_64$,
      $accounting_step_65$reset role$accounting_step_65$,
      $accounting_step_66$select pg_temp.expect_accounting_failure('update public.settlements set revenue=999 where id=(select id from pg_temp.accounting_snapshot)', 'settled period cannot be changed')$accounting_step_66$,
      $accounting_step_67$select pg_temp.expect_accounting_failure('delete from public.settlements where id=(select id from pg_temp.accounting_snapshot)', 'settled period cannot be changed')$accounting_step_67$,
      $accounting_step_68$select pg_temp.assert_accounting((select cost=0 from public.products where id=(select product_id from pg_temp.accounting_context)), 'New products no longer record batch costs')$accounting_step_68$,
      $accounting_step_69$select pg_temp.expect_accounting_failure('update public.products set cost=500 where id=(select product_id from pg_temp.accounting_context)', 'product cost accounting has been retired')$accounting_step_69$,
      $accounting_step_70$set local role anon$accounting_step_70$,
      $accounting_step_71$select pg_temp.expect_accounting_failure('select * from public.financial_period_costs', 'permission denied')$accounting_step_71$,
      $accounting_step_72$select pg_temp.expect_accounting_failure('select * from public.financial_period_cost_revisions', 'permission denied')$accounting_step_72$,
      $accounting_step_73$reset role$accounting_step_73$
    ] loop
      execute v_statement;
    end loop;
    select count(*)::integer into v_passed from pg_temp.accounting_checks;
    if v_passed <> 42 then
      raise exception 'Expected 42 accounting checks, got %', v_passed;
    end if;
    -- A private sentinel aborts this subtransaction, including every fixture write.
    raise exception using errcode = 'P0420', message = 'Accounting verification rollback';
  exception when sqlstate 'P0420' then
    if sqlerrm <> 'Accounting verification rollback' then raise; end if;
  end;
  raise notice 'passed_checks = %; all test data rolled back', v_passed;
end;
$accounting_editor$;
