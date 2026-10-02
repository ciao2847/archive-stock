begin;

-- One inventory-wide transfer account is used by every public claim form in
-- that inventory. Values remain stored while disabled so a manager can pause
-- displaying the account without re-entering it later.
alter table public.inventory_databases
  add column claim_transfer_enabled boolean not null default false,
  add column claim_bank_code text null,
  add column claim_bank_name text null,
  add column claim_bank_branch text null,
  add column claim_bank_account text null,
  add column claim_bank_account_name text null;

alter table public.inventory_databases
  add constraint inventory_databases_claim_bank_code_format
  check (claim_bank_code is null or claim_bank_code ~ '^[0-9]{3}$'),
  add constraint inventory_databases_claim_bank_name_length
  check (
    claim_bank_name is null
    or char_length(btrim(claim_bank_name)) between 1 and 80
  ),
  add constraint inventory_databases_claim_bank_branch_length
  check (
    claim_bank_branch is null
    or char_length(btrim(claim_bank_branch)) between 1 and 100
  ),
  add constraint inventory_databases_claim_bank_account_format
  check (
    claim_bank_account is null
    or claim_bank_account ~ '^[0-9]{5,20}$'
  ),
  add constraint inventory_databases_claim_bank_account_name_length
  check (
    claim_bank_account_name is null
    or char_length(btrim(claim_bank_account_name)) between 1 and 100
  ),
  add constraint inventory_databases_claim_transfer_enabled_fields
  check (
    not claim_transfer_enabled
    or (
      claim_bank_code is not null
      and claim_bank_name is not null
      and claim_bank_account is not null
      and claim_bank_account_name is not null
    )
  );

comment on column public.inventory_databases.claim_transfer_enabled is
  'Whether bank transfer details are returned after a successful public claim.';
comment on column public.inventory_databases.claim_bank_account is
  'Digits-only inventory-wide bank account shown only after a successful claim.';

-- Update public checkout text, LINE and transfer account atomically. The
-- established checkout updater authenticates and authorizes the inventory
-- membership before this definer function writes the additional columns.
create or replace function private.update_inventory_claim_payment_settings(
  p_inventory_id uuid,
  p_official_line_id text,
  p_completion_message text,
  p_transfer_enabled boolean,
  p_bank_code text,
  p_bank_name text,
  p_bank_branch text,
  p_bank_account text,
  p_bank_account_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bank_code text := nullif(regexp_replace(
    coalesce(p_bank_code, ''),
    '[^0-9]',
    '',
    'g'
  ), '');
  v_bank_name text := nullif(btrim(coalesce(p_bank_name, '')), '');
  v_bank_branch text := nullif(btrim(coalesce(p_bank_branch, '')), '');
  v_bank_account text := nullif(regexp_replace(
    coalesce(p_bank_account, ''),
    '[^0-9]',
    '',
    'g'
  ), '');
  v_bank_account_name text := nullif(
    btrim(coalesce(p_bank_account_name, '')),
    ''
  );
begin
  perform private.update_inventory_claim_checkout_settings(
    p_inventory_id,
    p_official_line_id,
    p_completion_message
  );

  if v_bank_code is not null and v_bank_code !~ '^[0-9]{3}$' then
    raise exception 'invalid bank code';
  end if;
  if v_bank_name is not null and char_length(v_bank_name) > 80 then
    raise exception 'invalid bank name';
  end if;
  if v_bank_branch is not null and char_length(v_bank_branch) > 100 then
    raise exception 'invalid bank branch';
  end if;
  if v_bank_account is not null
    and v_bank_account !~ '^[0-9]{5,20}$' then
    raise exception 'invalid bank account';
  end if;
  if v_bank_account_name is not null
    and char_length(v_bank_account_name) > 100 then
    raise exception 'invalid bank account name';
  end if;
  if coalesce(p_transfer_enabled, false) and (
    v_bank_code is null
    or v_bank_name is null
    or v_bank_account is null
    or v_bank_account_name is null
  ) then
    raise exception 'incomplete bank account';
  end if;

  update public.inventory_databases inventory
  set claim_transfer_enabled = coalesce(p_transfer_enabled, false),
      claim_bank_code = v_bank_code,
      claim_bank_name = v_bank_name,
      claim_bank_branch = v_bank_branch,
      claim_bank_account = v_bank_account,
      claim_bank_account_name = v_bank_account_name,
      updated_at = now()
  where inventory.id = p_inventory_id;

  if not found then
    raise exception 'inventory database not found';
  end if;

  return p_inventory_id;
end;
$$;

revoke all on function private.update_inventory_claim_payment_settings(
  uuid, text, text, boolean, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function private.update_inventory_claim_payment_settings(
  uuid, text, text, boolean, text, text, text, text, text
) to authenticated;

create or replace function public.update_inventory_claim_payment_settings(
  p_inventory_id uuid,
  p_official_line_id text,
  p_completion_message text,
  p_transfer_enabled boolean,
  p_bank_code text,
  p_bank_name text,
  p_bank_branch text,
  p_bank_account text,
  p_bank_account_name text
)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.update_inventory_claim_payment_settings(
    p_inventory_id,
    p_official_line_id,
    p_completion_message,
    p_transfer_enabled,
    p_bank_code,
    p_bank_name,
    p_bank_branch,
    p_bank_account,
    p_bank_account_name
  )
$$;

revoke all on function public.update_inventory_claim_payment_settings(
  uuid, text, text, boolean, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.update_inventory_claim_payment_settings(
  uuid, text, text, boolean, text, text, text, text, text
) to authenticated;

-- The account number is intentionally not part of get_public_claim_form. It
-- is returned only when the request UUID belongs to a successfully submitted
-- claim under the same public token.
create or replace function public.get_claim_transfer_account_for_submission(
  p_token uuid,
  p_request_id uuid
)
returns table(
  enabled boolean,
  bank_code text,
  bank_name text,
  bank_branch text,
  bank_account text,
  bank_account_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    inventory.claim_transfer_enabled,
    inventory.claim_bank_code,
    inventory.claim_bank_name,
    inventory.claim_bank_branch,
    inventory.claim_bank_account,
    inventory.claim_bank_account_name
  from public.claim_submissions submission
  join public.claim_forms form on form.id = submission.form_id
  join public.inventory_databases inventory on inventory.id = form.owner_id
  where form.public_token = p_token
    and submission.request_id = p_request_id
  limit 1
$$;

revoke all on function public.get_claim_transfer_account_for_submission(
  uuid, uuid
) from public, anon, authenticated;
grant execute on function public.get_claim_transfer_account_for_submission(
  uuid, uuid
) to anon, authenticated;

-- Payment events are stored separately from the claim so partial payments and
-- later balance payments keep their own date, account suffix and audit trail.
create table public.claim_submission_payments (
  id bigint generated always as identity primary key,
  submission_id bigint not null
    references public.claim_submissions(id) on delete restrict,
  amount numeric(12, 2) not null
    constraint claim_submission_payments_amount_positive
    check (amount > 0),
  transferred_at timestamptz not null,
  payer_account_last_five text null
    constraint claim_submission_payments_last_five_format
    check (
      payer_account_last_five is null
      or payer_account_last_five ~ '^[0-9]{5}$'
    ),
  note text null
    constraint claim_submission_payments_note_length
    check (note is null or char_length(note) <= 1000),
  created_by uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index claim_submission_payments_submission_id_idx
  on public.claim_submission_payments(submission_id, transferred_at desc, id desc);
create index claim_submission_payments_created_by_idx
  on public.claim_submission_payments(created_by);

alter table public.claim_submission_payments enable row level security;

revoke all on table public.claim_submission_payments
  from public, anon, authenticated;
grant select on table public.claim_submission_payments to authenticated;

create policy "inventory members read claim payments"
on public.claim_submission_payments for select to authenticated
using (
  exists (
    select 1
    from public.claim_submissions submission
    join public.claim_forms form on form.id = submission.form_id
    where submission.id = claim_submission_payments.submission_id
      and (
        form.owner_id = (select private.current_inventory_owner_id())
        or (select public.my_role()) = 'admin'
      )
  )
);

create or replace function private.record_claim_submission_payment(
  p_owner_id uuid,
  p_submission_id bigint,
  p_amount numeric,
  p_transferred_at timestamptz,
  p_payer_account_last_five text,
  p_note text
)
returns table(
  payment_id bigint,
  payment_status text,
  total_paid numeric,
  outstanding_amount numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.user_role;
  v_actual_owner_id uuid;
  v_total numeric(12, 2);
  v_paid_before numeric(12, 2);
  v_paid_after numeric(12, 2);
  v_payment_id bigint;
  v_payment_status text;
  v_last_five text := nullif(regexp_replace(
    coalesce(p_payer_account_last_five, ''),
    '[^0-9]',
    '',
    'g'
  ), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;
  select public.my_role() into v_role;
  if v_role is null or v_role not in ('admin', 'staff') then
    raise exception 'employee access required';
  end if;
  if p_owner_id is null or p_submission_id is null then
    raise exception 'invalid claim payment target';
  end if;
  if p_amount is null or p_amount <= 0
    or p_amount > 9999999999.99
    or p_amount <> round(p_amount, 2) then
    raise exception 'invalid claim payment amount';
  end if;
  if p_transferred_at is null
    or p_transferred_at > now() + interval '1 day' then
    raise exception 'invalid claim payment time';
  end if;
  if v_last_five is not null and v_last_five !~ '^[0-9]{5}$' then
    raise exception 'invalid payer account last five';
  end if;
  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'claim payment note is too long';
  end if;

  select form.owner_id
    into v_actual_owner_id
  from public.claim_submissions submission
  join public.claim_forms form on form.id = submission.form_id
  where submission.id = p_submission_id
  for update of submission;

  if not found then
    raise exception 'claim submission not found';
  end if;
  if v_actual_owner_id <> p_owner_id or (
    v_role <> 'admin'
    and v_actual_owner_id <> (select private.current_inventory_owner_id())
  ) then
    raise exception 'owner access required';
  end if;

  select coalesce(sum(item.quantity * item.unit_price), 0)
    into v_total
  from public.claim_submission_items item
  where item.submission_id = p_submission_id;

  select coalesce(sum(payment.amount), 0)
    into v_paid_before
  from public.claim_submission_payments payment
  where payment.submission_id = p_submission_id;

  if p_amount > greatest(v_total - v_paid_before, 0) then
    raise exception 'claim payment exceeds outstanding amount';
  end if;

  insert into public.claim_submission_payments(
    submission_id,
    amount,
    transferred_at,
    payer_account_last_five,
    note,
    created_by
  )
  values (
    p_submission_id,
    p_amount,
    p_transferred_at,
    v_last_five,
    v_note,
    (select auth.uid())
  )
  returning id into v_payment_id;

  v_paid_after := v_paid_before + p_amount;
  v_payment_status := case
    when v_paid_after >= v_total then 'paid'
    when v_paid_after > 0 then 'half_paid'
    else 'pending'
  end;

  update public.claim_submissions submission
  set payment_status = v_payment_status
  where submission.id = p_submission_id;

  return query select
    v_payment_id,
    v_payment_status,
    v_paid_after,
    greatest(v_total - v_paid_after, 0);
end;
$$;

revoke all on function private.record_claim_submission_payment(
  uuid, bigint, numeric, timestamptz, text, text
) from public, anon, authenticated;
grant execute on function private.record_claim_submission_payment(
  uuid, bigint, numeric, timestamptz, text, text
) to authenticated;

create or replace function public.record_claim_submission_payment(
  p_owner_id uuid,
  p_submission_id bigint,
  p_amount numeric,
  p_transferred_at timestamptz,
  p_payer_account_last_five text,
  p_note text
)
returns table(
  payment_id bigint,
  payment_status text,
  total_paid numeric,
  outstanding_amount numeric
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select *
  from private.record_claim_submission_payment(
    p_owner_id,
    p_submission_id,
    p_amount,
    p_transferred_at,
    p_payer_account_last_five,
    p_note
  )
$$;

revoke all on function public.record_claim_submission_payment(
  uuid, bigint, numeric, timestamptz, text, text
) from public, anon, authenticated;
grant execute on function public.record_claim_submission_payment(
  uuid, bigint, numeric, timestamptz, text, text
) to authenticated;

create or replace function private.delete_claim_submission_payment(
  p_owner_id uuid,
  p_payment_id bigint
)
returns table(
  submission_id bigint,
  payment_status text,
  total_paid numeric,
  outstanding_amount numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.user_role;
  v_submission_id bigint;
  v_actual_owner_id uuid;
  v_total numeric(12, 2);
  v_paid_after numeric(12, 2);
  v_payment_status text;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;
  select public.my_role() into v_role;
  if v_role is null or v_role not in ('admin', 'staff') then
    raise exception 'employee access required';
  end if;
  if p_owner_id is null or p_payment_id is null then
    raise exception 'invalid claim payment target';
  end if;

  select payment.submission_id, form.owner_id
    into v_submission_id, v_actual_owner_id
  from public.claim_submission_payments payment
  join public.claim_submissions submission
    on submission.id = payment.submission_id
  join public.claim_forms form on form.id = submission.form_id
  where payment.id = p_payment_id;

  if not found then
    raise exception 'claim payment not found';
  end if;
  if v_actual_owner_id <> p_owner_id or (
    v_role <> 'admin'
    and v_actual_owner_id <> (select private.current_inventory_owner_id())
  ) then
    raise exception 'owner access required';
  end if;

  perform 1
  from public.claim_submissions submission
  where submission.id = v_submission_id
  for update;

  delete from public.claim_submission_payments payment
  where payment.id = p_payment_id;

  select coalesce(sum(item.quantity * item.unit_price), 0)
    into v_total
  from public.claim_submission_items item
  where item.submission_id = v_submission_id;

  select coalesce(sum(payment.amount), 0)
    into v_paid_after
  from public.claim_submission_payments payment
  where payment.submission_id = v_submission_id;

  v_payment_status := case
    when v_paid_after >= v_total and v_total > 0 then 'paid'
    when v_paid_after > 0 then 'half_paid'
    else 'pending'
  end;

  update public.claim_submissions submission
  set payment_status = v_payment_status
  where submission.id = v_submission_id;

  return query select
    v_submission_id,
    v_payment_status,
    v_paid_after,
    greatest(v_total - v_paid_after, 0);
end;
$$;

revoke all on function private.delete_claim_submission_payment(uuid, bigint)
  from public, anon, authenticated;
grant execute on function private.delete_claim_submission_payment(uuid, bigint)
  to authenticated;

create or replace function public.delete_claim_submission_payment(
  p_owner_id uuid,
  p_payment_id bigint
)
returns table(
  submission_id bigint,
  payment_status text,
  total_paid numeric,
  outstanding_amount numeric
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select *
  from private.delete_claim_submission_payment(p_owner_id, p_payment_id)
$$;

revoke all on function public.delete_claim_submission_payment(uuid, bigint)
  from public, anon, authenticated;
grant execute on function public.delete_claim_submission_payment(uuid, bigint)
  to authenticated;

notify pgrst, 'reload schema';

commit;
