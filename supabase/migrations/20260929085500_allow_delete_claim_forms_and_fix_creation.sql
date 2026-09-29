begin;

-- Ensure multiple claim forms per owner is supported and any stale unique constraint is removed
alter table public.claim_forms
  drop constraint if exists claim_forms_owner_id_key;

drop index if exists public.claim_forms_owner_title_unique_idx;

create unique index if not exists claim_forms_owner_title_unique_idx
  on public.claim_forms(owner_id, lower(btrim(title)));

-- Grant delete permission and add RLS policy on claim_forms
grant delete on table public.claim_forms to authenticated;

drop policy if exists "inventory members delete claim forms" on public.claim_forms;

create policy "inventory members delete claim forms"
on public.claim_forms for delete to authenticated
using (
  owner_id = (select private.current_inventory_owner_id())
  or (select public.my_role()) = 'admin'
);

-- RPC to securely delete a claim form and its associated records (cascade)
create or replace function public.delete_claim_form(
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
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;

  select public.my_role() into v_role;
  if v_role is null or v_role not in ('admin', 'staff') then
    raise exception 'employee access required';
  end if;

  if p_owner_id is null or (
    v_role <> 'admin'
    and p_owner_id <> (select private.current_inventory_owner_id())
  ) then
    raise exception 'owner access required';
  end if;

  if p_form_id is null or p_form_id <= 0 then
    raise exception 'invalid claim form target';
  end if;

  delete from public.claim_forms form
  where form.id = p_form_id
    and form.owner_id = p_owner_id;

  if not found then
    raise exception 'claim form not found';
  end if;

  return true;
end;
$$;

revoke all on function public.delete_claim_form(bigint, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_claim_form(bigint, uuid)
  to authenticated;

notify pgrst, 'reload schema';

commit;
