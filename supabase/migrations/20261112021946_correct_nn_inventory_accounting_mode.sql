-- Follow-up for installations that already ran 20261112013316. That migration
-- matched the shorthand name; the user confirmed the full inventory name below.
begin;

do $migration$
declare
  v_inventory_id uuid;
  v_admin_id uuid;
  v_matches integer;
  v_previous_subject text := current_setting('request.jwt.claim.sub', true);
begin
  -- This is a one-off owner-run deployment script, not an application RPC.
  if not pg_catalog.pg_has_role(current_user,
    (select relowner from pg_catalog.pg_class where oid='public.inventory_databases'::regclass), 'USAGE') then
    raise exception 'Run this migration as the database owner (SQL Editor postgres role)';
  end if;
  if pg_catalog.to_regprocedure('public.set_inventory_accounting_mode(uuid,text)') is null then
    raise exception 'Apply 20261112013316_inventory_fifo_cost_accounting.sql first';
  end if;
  select count(*) into v_matches from public.inventory_databases where name='NN佛系海報代購';
  if v_matches<>1 then
    raise exception 'Expected one inventory named NN佛系海報代購, found %', v_matches;
  end if;
  select id into v_inventory_id from public.inventory_databases where name='NN佛系海報代購' for update;
  select id into v_admin_id from public.profiles where role='admin' order by id limit 1;
  if v_admin_id is null then raise exception 'An existing application administrator is required'; end if;

  -- Use the checked activation path so opening batches and unsettled outbound
  -- allocations are initialized atomically, with all triggers and RLS intact.
  -- The owner supplies an existing admin subject only within this transaction.
  perform pg_catalog.set_config('request.jwt.claim.sub', v_admin_id::text, true);
  perform public.set_inventory_accounting_mode(v_inventory_id, 'product_fifo');
  perform pg_catalog.set_config('request.jwt.claim.sub', coalesce(v_previous_subject, ''), true);
end;
$migration$;

commit;

-- Show an explicit result table when this file is run in the SQL Editor.
select i.id, i.name, i.accounting_mode,
  (select count(*) from public.inventory_cost_batches b where b.owner_id=i.id) as cost_batch_count
from public.inventory_databases i
where i.name in ('NN佛系海報代購', '海報小天地')
order by i.name;
