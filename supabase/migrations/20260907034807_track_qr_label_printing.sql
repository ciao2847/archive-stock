begin;

-- Printing is independent from QR consumption. A printed label must remain
-- scannable for packing, while the print action itself must be one-time.
alter table public.product_qr_labels
  add column if not exists printed_at timestamptz,
  add column if not exists printed_by uuid references public.profiles(id);

create index if not exists product_qr_labels_printable_batch_idx
  on public.product_qr_labels (product_id, created_at, id)
  where status = 'active' and printed_at is null;

-- Mark a set of active labels as printed atomically. The parent product RLS
-- policy keeps this scoped to the caller's inventory, including shared members.
create or replace function public.mark_product_qr_labels_printed(
  p_label_ids uuid[]
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_requested_count integer;
  v_available_count integer;
begin
  if (select public.my_role()) not in ('admin', 'staff') then
    raise exception 'employee access required';
  end if;

  select count(*)::integer
  into v_requested_count
  from (select distinct label_id from unnest(p_label_ids) as labels(label_id)) requested;

  if p_label_ids is null or v_requested_count = 0 then
    raise exception 'at least one QR label is required';
  end if;

  select count(*)::integer
  into v_available_count
  from public.product_qr_labels label
  where label.id = any(p_label_ids)
    and label.status = 'active'
    and label.printed_at is null;

  if v_available_count <> v_requested_count then
    raise exception 'one or more QR labels are already printed or unavailable';
  end if;

  update public.product_qr_labels
  set printed_at = now(), printed_by = (select auth.uid())
  where id = any(p_label_ids)
    and status = 'active'
    and printed_at is null;

  return true;
end;
$$;

revoke all on function public.mark_product_qr_labels_printed(uuid[]) from public, anon;
grant execute on function public.mark_product_qr_labels_printed(uuid[]) to authenticated;

notify pgrst, 'reload schema';

commit;
