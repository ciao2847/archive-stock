begin;

-- Safe customer claim summary query for public inquiry / LINE Bot.
-- Returns aggregated claim details for a normalized Taiwan mobile phone.
create or replace function public.query_customer_claims_summary(p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_result jsonb;
begin
  if v_phone !~ '^09[0-9]{8}$' then
    return jsonb_build_object(
      'valid', false,
      'error', 'invalid_phone'
    );
  end if;

  select
    jsonb_build_object(
      'valid', true,
      'found', count(sub.id) > 0,
      'phone', v_phone,
      'nickname', coalesce(max(sub.nickname), ''),
      'store_name', coalesce(max(inv.name), '庫藏預購'),
      'official_line_id', coalesce(max(inv.official_line_id), ''),
      'completion_message', coalesce(max(inv.claim_completion_message), ''),
      'unsettled_amount', coalesce(sum(
        case
          when sub.payment_status = 'paid' then 0
          when sub.payment_status = 'half_paid' then round(sub_items.total / 2)
          else sub_items.total
        end
      ), 0),
      'unsettled_items_count', coalesce(sum(
        case
          when sub.payment_status != 'paid' then sub_items.qty
          else 0
        end
      ), 0),
      'total_amount', coalesce(sum(sub_items.total), 0),
      'total_items_count', coalesce(sum(sub_items.qty), 0),
      'all_paid', coalesce(bool_and(sub.payment_status = 'paid'), false),
      'submissions', coalesce(
        jsonb_agg(
          jsonb_build_object(
            'form_title', form.title,
            'confirmation_code', sub.confirmation_code,
            'payment_status', sub.payment_status,
            'created_at', sub.created_at,
            'items', sub_items.items_json
          ) order by sub.created_at desc
        ) filter (where sub.id is not null),
        '[]'::jsonb
      )
    )
  into v_result
  from public.claim_submissions sub
  join public.claim_forms form on form.id = sub.form_id
  left join public.inventory_databases inv on inv.id = form.owner_id
  cross join lateral (
    select
      coalesce(sum(item.quantity * item.unit_price), 0) as total,
      coalesce(sum(item.quantity), 0) as qty,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'name', item.product_name,
            'quantity', item.quantity,
            'unit_price', item.unit_price,
            'subtotal', item.quantity * item.unit_price
          ) order by item.id
        ),
        '[]'::jsonb
      ) as items_json
    from public.claim_submission_items item
    where item.submission_id = sub.id
  ) sub_items
  where sub.phone_normalized = v_phone;

  return v_result;
end;
$$;

revoke all on function public.query_customer_claims_summary(text)
  from public, anon, authenticated;
grant execute on function public.query_customer_claims_summary(text)
  to anon, authenticated;

notify pgrst, 'reload schema';

commit;
