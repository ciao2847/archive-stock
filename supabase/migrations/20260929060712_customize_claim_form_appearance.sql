begin;

alter table public.claim_forms
  add column banner_image_path text,
  add column theme_primary_color text not null default '#5A87B1',
  add column theme_background_color text not null default '#F3F7FB',
  add column theme_surface_color text not null default '#FFFFFF';

alter table public.claim_forms
  add constraint claim_forms_banner_image_path_format
    check (
      banner_image_path is null
      or (
        char_length(banner_image_path) between 1 and 500
        and banner_image_path
          ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.webp$'
        and split_part(banner_image_path, '/', 1) = owner_id::text
      )
    ),
  add constraint claim_forms_theme_primary_color_format
    check (theme_primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  add constraint claim_forms_theme_background_color_format
    check (theme_background_color ~ '^#[0-9A-Fa-f]{6}$'),
  add constraint claim_forms_theme_surface_color_format
    check (theme_surface_color ~ '^#[0-9A-Fa-f]{6}$');

-- Existing forms for 海報小天地 start with the navy-and-ivory palette from
-- the supplied visual reference. Every form can still change these colours.
update public.claim_forms form
set theme_primary_color = '#17345F',
    theme_background_color = '#10264A',
    theme_surface_color = '#F7F1E7',
    updated_at = now()
from public.inventory_databases inventory
where inventory.id = form.owner_id
  and inventory.name = '海報小天地';

insert into storage.buckets(
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'claim-form-assets',
  'claim-form-assets',
  true,
  10485760,
  array['image/webp']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "inventory members upload claim form assets"
  on storage.objects;
create policy "inventory members upload claim form assets"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'claim-form-assets'
  and name
    ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.webp$'
  and (select public.my_role()) in ('admin', 'staff')
  and (
    (select public.my_role()) = 'admin'
    or (storage.foldername(name))[1]
      = (select private.current_inventory_owner_id())::text
  )
);

drop policy if exists "inventory members delete claim form assets"
  on storage.objects;
create policy "inventory members delete claim form assets"
on storage.objects for delete to authenticated
using (
  bucket_id = 'claim-form-assets'
  and name
    ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.webp$'
  and (select public.my_role()) in ('admin', 'staff')
  and (
    (select public.my_role()) = 'admin'
    or (storage.foldername(name))[1]
      = (select private.current_inventory_owner_id())::text
  )
);

-- Keep the established form/product transaction intact and add appearance in
-- an overload, so older deployed frontends remain compatible during rollout.
create or replace function public.configure_claim_form(
  p_form_id bigint,
  p_owner_id uuid,
  p_title text,
  p_description text,
  p_is_open boolean,
  p_closes_at timestamptz,
  p_products jsonb,
  p_banner_image_path text,
  p_theme_primary_color text,
  p_theme_background_color text,
  p_theme_surface_color text
)
returns table(form_id bigint, public_token uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_form_id bigint;
  v_public_token uuid;
  v_banner_image_path text := nullif(trim(p_banner_image_path), '');
begin
  if v_banner_image_path is not null and (
    char_length(v_banner_image_path) > 500
    or split_part(v_banner_image_path, '/', 1) <> p_owner_id::text
    or v_banner_image_path
      !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.webp$'
  ) then
    raise exception 'invalid claim form banner image';
  end if;

  if p_theme_primary_color is null
    or p_theme_primary_color !~ '^#[0-9A-Fa-f]{6}$'
    or p_theme_background_color is null
    or p_theme_background_color !~ '^#[0-9A-Fa-f]{6}$'
    or p_theme_surface_color is null
    or p_theme_surface_color !~ '^#[0-9A-Fa-f]{6}$'
  then
    raise exception 'invalid claim form theme';
  end if;

  select configured.form_id, configured.public_token
    into v_form_id, v_public_token
  from public.configure_claim_form(
    p_form_id,
    p_owner_id,
    p_title,
    p_description,
    p_is_open,
    p_closes_at,
    p_products
  ) configured;

  update public.claim_forms form
  set banner_image_path = v_banner_image_path,
      theme_primary_color = upper(p_theme_primary_color),
      theme_background_color = upper(p_theme_background_color),
      theme_surface_color = upper(p_theme_surface_color),
      updated_at = now()
  where form.id = v_form_id
    and form.owner_id = p_owner_id;

  if not found then
    raise exception 'claim form not found';
  end if;

  return query select v_form_id, v_public_token;
end;
$$;

revoke all on function public.configure_claim_form(
  bigint, uuid, text, text, boolean, timestamptz, jsonb,
  text, text, text, text
) from public, anon, authenticated;
grant execute on function public.configure_claim_form(
  bigint, uuid, text, text, boolean, timestamptz, jsonb,
  text, text, text, text
) to authenticated;

-- Public claim pages only receive appearance values through an unguessable
-- public token. Direct anonymous reads on claim_forms remain revoked.
create or replace function public.get_public_claim_form_appearance(p_token uuid)
returns table(
  banner_image_path text,
  theme_primary_color text,
  theme_background_color text,
  theme_surface_color text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    form.banner_image_path,
    form.theme_primary_color,
    form.theme_background_color,
    form.theme_surface_color
  from public.claim_forms form
  where form.public_token = p_token;
$$;

revoke all on function public.get_public_claim_form_appearance(uuid)
  from public, anon, authenticated;
grant execute on function public.get_public_claim_form_appearance(uuid)
  to anon, authenticated;

notify pgrst, 'reload schema';

commit;
