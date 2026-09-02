drop function if exists public.adjust_product_stock(uuid, integer);

create function public.adjust_product_stock(
  p_product_id uuid,
  p_new_stock integer
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_current_stock integer;
  v_current_status public.product_status;
  v_difference integer;
  v_active_labels integer;
  v_revoked_labels integer;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if p_new_stock is null or p_new_stock < 0 then
    raise exception 'stock must be a nonnegative integer';
  end if;

  select p.stock, p.status
  into v_current_stock, v_current_status
  from public.products p
  where p.id = p_product_id
  for update;

  if not found then
    raise exception 'product not found';
  end if;

  v_difference := p_new_stock - v_current_stock;

  if v_difference > 0 then
    insert into public.product_qr_labels(product_id, batch_code)
    select
      p_product_id,
      'ADJUST-' || to_char(current_date, 'YYYYMMDD')
    from generate_series(1, v_difference);
  elsif v_difference < 0 then
    select count(*)::integer
    into v_active_labels
    from public.product_qr_labels q
    where q.product_id = p_product_id
      and q.status = 'active';

    if v_active_labels < abs(v_difference) then
      raise exception 'not enough active qr labels';
    end if;

    update public.product_qr_labels q
    set status = 'revoked'
    where q.id in (
      select candidate.id
      from public.product_qr_labels candidate
      where candidate.product_id = p_product_id
        and candidate.status = 'active'
      order by candidate.created_at desc, candidate.id desc
      limit abs(v_difference)
      for update
    );

    get diagnostics v_revoked_labels = row_count;
    if v_revoked_labels <> abs(v_difference) then
      raise exception 'not enough active qr labels';
    end if;
  end if;

  update public.products
  set stock = p_new_stock,
      status = case
        when p_new_stock = 0 then 'packed'::public.product_status
        when v_current_status in ('packed', 'shipped')
          then 'in_stock'::public.product_status
        else v_current_status
      end,
      updated_at = now()
  where id = p_product_id;

  return p_new_stock;
end $$;

revoke execute on function public.adjust_product_stock(uuid, integer) from public, anon;
grant execute on function public.adjust_product_stock(uuid, integer) to authenticated;

notify pgrst, 'reload schema';

select
  to_regprocedure('public.adjust_product_stock(uuid,integer)') is not null
  and has_function_privilege(
    'authenticated',
    'public.adjust_product_stock(uuid,integer)',
    'execute'
  ) as adjust_product_stock_ready;
