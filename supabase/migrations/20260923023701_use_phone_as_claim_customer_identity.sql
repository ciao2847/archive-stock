begin;

-- A group nickname is display-only and may contain a typo. The validated
-- Taiwanese mobile number is the stable customer identity used by lookups and
-- customer-count summaries.
create or replace function public.get_claim_form_summary(p_form_id bigint)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_role public.user_role;
  v_owner_id uuid;
  v_result jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;
  select public.my_role() into v_role;
  if v_role is null or v_role not in ('admin', 'staff') then
    raise exception 'employee access required';
  end if;

  select form.owner_id into v_owner_id
  from public.claim_forms form
  where form.id = p_form_id;
  if not found then
    raise exception 'claim form not found';
  end if;
  if v_role <> 'admin'
    and v_owner_id <> (select private.current_inventory_owner_id()) then
    raise exception 'owner access required';
  end if;

  select jsonb_build_object(
    'submission_count', (
      select count(*)
      from public.claim_submissions submission
      where submission.form_id = p_form_id
    ),
    'customer_count', (
      select count(distinct submission.phone_normalized)
      from public.claim_submissions submission
      where submission.form_id = p_form_id
    ),
    'item_count', (
      select coalesce(sum(item.quantity), 0)
      from public.claim_submission_items item
      join public.claim_submissions submission
        on submission.id = item.submission_id
      where submission.form_id = p_form_id
    ),
    'estimated_total', (
      select coalesce(sum(item.quantity * item.unit_price), 0)
      from public.claim_submission_items item
      join public.claim_submissions submission
        on submission.id = item.submission_id
      where submission.form_id = p_form_id
    ),
    'product_totals', coalesce(
      (
        select jsonb_agg(product_total.payload order by
          product_total.quantity desc,
          product_total.product_name
        )
        from (
          select
            item.product_id,
            coalesce(product.sku, item.product_sku) as product_sku,
            coalesce(listing.display_name, item.product_name)
              as product_name,
            sum(item.quantity)::integer as quantity,
            count(distinct submission.phone_normalized)::integer
              as customer_count,
            jsonb_build_object(
              'product_id', item.product_id,
              'sku', coalesce(product.sku, item.product_sku),
              'name', coalesce(listing.display_name, item.product_name),
              'quantity', sum(item.quantity),
              'customer_count',
                count(distinct submission.phone_normalized)
            ) as payload
          from public.claim_submission_items item
          join public.claim_submissions submission
            on submission.id = item.submission_id
          left join public.products product on product.id = item.product_id
          left join public.claim_form_products listing
            on listing.form_id = p_form_id
           and listing.product_id = item.product_id
          where submission.form_id = p_form_id
          group by
            item.product_id,
            coalesce(product.sku, item.product_sku),
            coalesce(listing.display_name, item.product_name)
        ) product_total
      ),
      '[]'::jsonb
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_claim_form_summary(bigint)
  from public, anon, authenticated;
grant execute on function public.get_claim_form_summary(bigint)
  to authenticated;

notify pgrst, 'reload schema';

commit;
