begin;

-- Every signed-in inventory user may remove customer claim details from their
-- own inventory. Admins retain cross-inventory access.
drop policy if exists "admins delete claim submissions"
  on public.claim_submissions;
drop policy if exists "inventory members delete claim submissions"
  on public.claim_submissions;

create policy "inventory members delete claim submissions"
on public.claim_submissions for delete to authenticated
using (
  exists (
    select 1
    from public.claim_forms form
    where form.id = claim_submissions.form_id
      and (
        form.owner_id = (select private.current_inventory_owner_id())
        or (select public.my_role()) = 'admin'
      )
  )
);

grant delete on table public.claim_submissions to authenticated;

create or replace function public.delete_claim_submission(
  p_submission_id bigint,
  p_form_id bigint,
  p_owner_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_role public.user_role;
  v_deleted_id bigint;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;

  select public.my_role() into v_role;
  if v_role is null or v_role not in ('admin', 'staff') then
    raise exception 'employee access required';
  end if;
  if p_submission_id is null or p_form_id is null or p_owner_id is null then
    raise exception 'invalid claim submission target';
  end if;
  if v_role <> 'admin'
    and p_owner_id is distinct from (
      select private.current_inventory_owner_id()
    ) then
    raise exception 'owner access required';
  end if;

  delete from public.claim_submissions submission
  where submission.id = p_submission_id
    and submission.form_id = p_form_id
    and exists (
      select 1
      from public.claim_forms form
      where form.id = submission.form_id
        and form.owner_id = p_owner_id
    )
  returning submission.id into v_deleted_id;

  if v_deleted_id is null then
    raise exception 'claim submission not found';
  end if;

  return true;
end;
$$;

revoke all on function public.delete_claim_submission(bigint, bigint, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_claim_submission(bigint, bigint, uuid)
  to authenticated;

notify pgrst, 'reload schema';

commit;
