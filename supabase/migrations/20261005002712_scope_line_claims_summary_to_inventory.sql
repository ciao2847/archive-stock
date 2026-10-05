begin;

-- LINE claim lookups must stay inside the inventory linked to that LINE bot.
-- Drop the previous phone-only overload so PostgREST cannot expose an
-- unscoped lookup alongside the new function.
drop function if exists public.query_customer_claims_summary(text);

create function public.query_customer_claims_summary(
  p_phone text,
  p_inventory_id uuid
)
returns jsonb
language sql
stable
security definer
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
      coalesce(database.claim_bank_account, '') as bank_account,
      coalesce(database.claim_bank_account_name, '') as bank_account_name
    from public.inventory_databases database
    where database.id = p_inventory_id
  ),
  claim_base as (
    select
      submission.id,
      submission.nickname,
      submission.payment_status as stored_payment_status,
      submission.confirmation_code,
      submission.created_at,
      form.title as form_title,
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
  claim_paid as (
    select
      claim_base.*,
      least(
        claim_base.total_amount,
        case
          when claim_base.payment_count > 0 then
            claim_base.total_paid_from_events
          when claim_base.stored_payment_status = 'paid' then
            claim_base.total_amount
          when claim_base.stored_payment_status = 'half_paid' then
            round(claim_base.total_amount / 2, 2)
          else 0
        end
      )::numeric(12, 2) as paid_amount
    from claim_base
  ),
  claim_scoped as (
    select
      claim_paid.*,
      greatest(claim_paid.total_amount - claim_paid.paid_amount, 0)::numeric(12, 2)
        as outstanding_amount,
      case
        when claim_paid.total_amount > 0
          and claim_paid.paid_amount >= claim_paid.total_amount then 'paid'
        when claim_paid.paid_amount > 0 then 'half_paid'
        else 'pending'
      end as effective_payment_status
    from claim_paid
  ),
  summary as (
    select
      count(claim_scoped.id) as submission_count,
      coalesce(max(claim_scoped.nickname), '') as nickname,
      coalesce(sum(claim_scoped.outstanding_amount), 0) as unsettled_amount,
      coalesce(sum(
        case
          when claim_scoped.outstanding_amount > 0 then claim_scoped.items_count
          else 0
        end
      ), 0) as unsettled_items_count,
      coalesce(sum(claim_scoped.total_amount), 0) as total_amount,
      coalesce(sum(claim_scoped.items_count), 0) as total_items_count,
      count(claim_scoped.id) > 0
        and coalesce(bool_and(claim_scoped.outstanding_amount = 0), false)
        as all_paid,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'form_title', claim_scoped.form_title,
            'confirmation_code', claim_scoped.confirmation_code,
            'payment_status', claim_scoped.effective_payment_status,
            'paid_amount', claim_scoped.paid_amount,
            'outstanding_amount', claim_scoped.outstanding_amount,
            'created_at', claim_scoped.created_at,
            'items', claim_scoped.items_json
          ) order by claim_scoped.created_at desc
        ) filter (where claim_scoped.id is not null),
        '[]'::jsonb
      ) as submissions
    from claim_scoped
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
            'account', inventory.bank_account,
            'account_name', inventory.bank_account_name
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
  from public, anon, authenticated;
grant execute on function public.query_customer_claims_summary(text, uuid)
  to anon;

notify pgrst, 'reload schema';

commit;
