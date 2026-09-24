begin;

-- Optional nicknames are not reliable enough to split one person into
-- separate packing queues. A contact remains the strongest identifier; when
-- it is absent, the normalized customer name is used for grouping.
create or replace function public.customer_identity_key(
  p_name text,
  p_nickname text,
  p_contact text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when nullif(btrim(coalesce(p_contact, '')), '') is not null
      then 'contact:' || lower(btrim(p_contact))
    else 'name:' || lower(btrim(coalesce(p_name, '')))
  end
$$;

revoke all on function public.customer_identity_key(text, text, text)
  from public, anon, authenticated;

-- Earlier package records stored the optional nickname in their key. Move
-- those records to the new name key and merge duplicate open packages so a
-- customer does not receive two packing jobs. Scans and quantities are moved
-- into the oldest open package for that customer.
do $$
declare
  v_package record;
  v_survivor_id uuid;
  v_key text;
begin
  for v_package in
    select pp.id, pp.owner_id, pp.customer_name, pp.customer_key
    from public.packing_packages pp
    where pp.status = 'packing'
      and pp.customer_key like 'name:%'
    order by pp.owner_id, pp.created_at, pp.id
  loop
    v_key := 'name:' || lower(btrim(v_package.customer_name));

    select pp.id
      into v_survivor_id
    from public.packing_packages pp
    where pp.owner_id = v_package.owner_id
      and pp.customer_key = v_key
      and pp.status = 'packing'
      and pp.id <> v_package.id
    order by pp.created_at, pp.id
    limit 1
    for update;

    if v_survivor_id is null then
      update public.packing_packages
      set customer_key = v_key, updated_at = now()
      where id = v_package.id;
      continue;
    end if;

    update public.packing_scans
    set package_id = v_survivor_id
    where package_id = v_package.id;

    insert into public.packing_package_items(
      package_id, order_id, order_item_id, product_id, quantity
    )
    select
      v_survivor_id, ppi.order_id, ppi.order_item_id, ppi.product_id, ppi.quantity
    from public.packing_package_items ppi
    where ppi.package_id = v_package.id
    on conflict (package_id, order_item_id)
    do update set quantity = public.packing_package_items.quantity + excluded.quantity;

    delete from public.packing_package_items
    where package_id = v_package.id;

    update public.packing_packages
    set status = 'cancelled', updated_at = now()
    where id = v_package.id;
  end loop;

  update public.packing_packages pp
  set customer_key = 'name:' || lower(btrim(pp.customer_name)),
      updated_at = now()
  where pp.status <> 'packing'
    and pp.customer_key like 'name:%';
end;
$$;

notify pgrst, 'reload schema';
commit;
