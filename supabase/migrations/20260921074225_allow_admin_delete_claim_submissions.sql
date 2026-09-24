begin;

-- Keep deletion unavailable to signed-out visitors and staff. Authenticated
-- users receive the table privilege required by Postgres, while RLS limits the
-- affected rows to callers whose application role is admin.
grant delete on table public.claim_submissions to authenticated;

create policy "admins delete claim submissions"
on public.claim_submissions for delete to authenticated
using ((select public.my_role()) = 'admin');

-- Validate the complete management context in one database operation so a
-- stale or tampered request cannot delete a submission from another form.
-- claim_submission_items are removed by the existing ON DELETE CASCADE FK.
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
  v_deleted_id bigint;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;
  if (select public.my_role()) <> 'admin' then
    raise exception 'admin access required';
  end if;
  if p_submission_id is null or p_form_id is null or p_owner_id is null then
    raise exception 'invalid claim submission target';
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
