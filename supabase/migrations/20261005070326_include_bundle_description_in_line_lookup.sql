begin;

create or replace function public.query_customer_claims_summary(
  p_phone text,
  p_inventory_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with input as (
    select regexp_replace(
      coalesce(p_phone, ''),
      '[^0-9]',
      '',
      'g'
    ) as normalized_phone
  ),
  inventory as (
    select
      database.id,
      database.name,
      coalesce(database.official_line_id, '') as official_line_id,
      coalesce(database.claim_completion_message, '') as completion_message,
      coalesce(database.claim_transfer_enabled, false) as transfer_enabled,
      coalesce(database.claim_bank_code, '') as bank_code,
      coalesce(database.claim_bank_name, '') as bank_name,
      coalesce(database.claim_bank_branch, '') as bank_branch,
      coalesce(database.claim_bank_account, '') as bank_account
    from public.inventory_databases database
    where database.id = p_inventory_id
  ),
  claim_base as (
    select
      'claim'::text as source_type,
      submission.id,
      submission.nickname,
      submission.payment_status as stored_payment_status,
      submission.confirmation_code,
      submission.created_at,
      form.title as form_title,
      null::text as description,
      item_totals.total_amount,
      item_totals.items_count,
      item_totals.items_json,
      payment_totals.payment_count,
      payment_totals.total_paid_from_events
    from public.claim_submissions submission
    join public.claim_forms form on form.id = submission.form_id
    cross join lateral (
      select
        coalesce(sum(item.quantity * item.unit_price), 0)::numeric(12, 2)
          as total_amount,
        coalesce(sum(item.quantity), 0)::bigint as items_count,
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
      where item.submission_id = submission.id
    ) item_totals
    cross join lateral (
      select
        count(payment.id)::integer as payment_count,
        coalesce(sum(payment.amount), 0)::numeric(12, 2)
          as total_paid_from_events
      from public.claim_submission_payments payment
      where payment.submission_id = submission.id
    ) payment_totals
    cross join input
    where form.owner_id = p_inventory_id
      and submission.phone_normalized = input.normalized_phone
  ),
  bundle_base as (
    select
      'bundle'::text as source_type,
      bundle_order.id,
      bundle_order.customer_nickname as nickname,
      case when payment.id is null then 'pending' else 'paid' end
        as stored_payment_status,
      bundle_order.confirmation_code,
      bundle_order.confirmed_at as created_at,
      '單張大禮包喊單'::text as form_title,
      bundle_order.description,
      bundle_order.total_amount,
      1::bigint as items_count,
      jsonb_build_array(
        jsonb_build_object(
          'name', bundle_order.title,
          'quantity', 1,
          'unit_price', bundle_order.total_amount,
          'subtotal', bundle_order.total_amount
        )
      ) as items_json,
      case when payment.id is null then 0 else 1 end::integer as payment_count,
      coalesce(payment.amount, 0)::numeric(12, 2) as total_paid_from_events
    from public.bundle_claim_orders bundle_order
    left join public.bundle_claim_payments payment
      on payment.order_id = bundle_order.id
    cross join input
    where bundle_order.owner_id = p_inventory_id
      and bundle_order.status = 'confirmed'
      and bundle_order.customer_phone_normalized = input.normalized_phone
  ),
  entry_base as (
    select * from claim_base
    union all
    select * from bundle_base
  ),
  entry_paid as (
    select
      entry_base.*,
      least(
        entry_base.total_amount,
        case
          when entry_base.payment_count > 0 then
            entry_base.total_paid_from_events
          when entry_base.stored_payment_status = 'paid' then
            entry_base.total_amount
          when entry_base.stored_payment_status = 'half_paid' then
            round(entry_base.total_amount / 2, 2)
          else 0
        end
      )::numeric(12, 2) as paid_amount
    from entry_base
  ),
  entry_scoped as (
    select
      entry_paid.*,
      greatest(entry_paid.total_amount - entry_paid.paid_amount, 0)::numeric(12, 2)
        as outstanding_amount,
      case
        when entry_paid.total_amount > 0
          and entry_paid.paid_amount >= entry_paid.total_amount then 'paid'
        when entry_paid.paid_amount > 0 then 'half_paid'
        else 'pending'
      end as effective_payment_status
    from entry_paid
  ),
  summary as (
    select
      count(entry_scoped.id) as submission_count,
      coalesce(max(entry_scoped.nickname), '') as nickname,
      coalesce(sum(entry_scoped.outstanding_amount), 0) as unsettled_amount,
      coalesce(sum(
        case
          when entry_scoped.outstanding_amount > 0 then entry_scoped.items_count
          else 0
        end
      ), 0) as unsettled_items_count,
      coalesce(sum(entry_scoped.total_amount), 0) as total_amount,
      coalesce(sum(entry_scoped.items_count), 0) as total_items_count,
      count(entry_scoped.id) > 0
        and coalesce(bool_and(entry_scoped.outstanding_amount = 0), false)
        as all_paid,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'source_type', entry_scoped.source_type,
            'form_title', entry_scoped.form_title,
            'description', entry_scoped.description,
            'confirmation_code', entry_scoped.confirmation_code,
            'payment_status', entry_scoped.effective_payment_status,
            'paid_amount', entry_scoped.paid_amount,
            'outstanding_amount', entry_scoped.outstanding_amount,
            'created_at', entry_scoped.created_at,
            'items', entry_scoped.items_json
          ) order by entry_scoped.created_at desc
        ) filter (where entry_scoped.id is not null),
        '[]'::jsonb
      ) as submissions
    from entry_scoped
  )
  select case
    when input.normalized_phone !~ '^09[0-9]{8}$' then
      jsonb_build_object('valid', false, 'error', 'invalid_phone')
    when p_inventory_id is null or inventory.id is null then
      jsonb_build_object('valid', false, 'error', 'invalid_inventory')
    else jsonb_build_object(
      'valid', true,
      'found', summary.submission_count > 0,
      'phone', input.normalized_phone,
      'nickname', summary.nickname,
      'store_name', inventory.name,
      'official_line_id', inventory.official_line_id,
      'completion_message', inventory.completion_message,
      'transfer_account', case
        when inventory.transfer_enabled
          and nullif(btrim(inventory.bank_account), '') is not null then
          jsonb_build_object(
            'enabled', true,
            'bank_code', inventory.bank_code,
            'bank_name', inventory.bank_name,
            'bank_branch', inventory.bank_branch,
            'account', inventory.bank_account
          )
        else null
      end,
      'unsettled_amount', summary.unsettled_amount,
      'unsettled_items_count', summary.unsettled_items_count,
      'total_amount', summary.total_amount,
      'total_items_count', summary.total_items_count,
      'all_paid', summary.all_paid,
      'submissions', summary.submissions
    )
  end
  from input
  cross join summary
  left join inventory on true
$$;

revoke all on function public.query_customer_claims_summary(text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.query_customer_claims_summary(text, uuid)
  to service_role;

notify pgrst, 'reload schema';

commit;
