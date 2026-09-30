begin;

-- This function must be executable by the security-invoker public wrapper.
-- Keep the privileged write narrow and repeat authorization and input
-- validation here so direct authenticated calls cannot bypass tenant checks.
create or replace function private.update_inventory_claim_appearance(
  p_inventory_id uuid,
  p_banner_image_path text,
  p_banner_position_x integer,
  p_banner_position_y integer,
  p_theme_primary_color text,
  p_theme_background_color text,
  p_theme_surface_color text,
  p_theme_header_text_color text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_role public.user_role;
  v_banner_image_path text := nullif(trim(p_banner_image_path), '');
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;

  select public.my_role() into v_role;
  if v_role is null or v_role not in ('admin', 'staff') then
    raise exception 'employee access required';
  end if;
  if p_inventory_id is null or (
    v_role <> 'admin'
    and not exists (
      select 1
      from public.inventory_database_members membership
      where membership.inventory_id = p_inventory_id
        and membership.user_id = v_user_id
    )
  ) then
    raise exception 'owner access required';
  end if;

  if v_banner_image_path is not null and (
    char_length(v_banner_image_path) > 500
    or split_part(v_banner_image_path, '/', 1) <> p_inventory_id::text
    or v_banner_image_path
      !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.webp$'
  ) then
    raise exception 'invalid claim form banner image';
  end if;

  if p_banner_position_x is null
    or p_banner_position_x not between 0 and 100
    or p_banner_position_y is null
    or p_banner_position_y not between 0 and 100
  then
    raise exception 'invalid claim form banner position';
  end if;

  if p_theme_primary_color is null
    or p_theme_primary_color !~ '^#[0-9A-Fa-f]{6}$'
    or p_theme_background_color is null
    or p_theme_background_color !~ '^#[0-9A-Fa-f]{6}$'
    or p_theme_surface_color is null
    or p_theme_surface_color !~ '^#[0-9A-Fa-f]{6}$'
    or p_theme_header_text_color is null
    or p_theme_header_text_color !~ '^#[0-9A-Fa-f]{6}$'
  then
    raise exception 'invalid claim form theme';
  end if;

  update public.inventory_databases inventory
  set claim_banner_image_path = v_banner_image_path,
      claim_banner_position_x = p_banner_position_x,
      claim_banner_position_y = p_banner_position_y,
      claim_theme_primary_color = upper(p_theme_primary_color),
      claim_theme_background_color = upper(p_theme_background_color),
      claim_theme_surface_color = upper(p_theme_surface_color),
      claim_theme_header_text_color = upper(p_theme_header_text_color),
      updated_at = now()
  where inventory.id = p_inventory_id;

  if not found then
    raise exception 'inventory database not found';
  end if;
end;
$$;

revoke all on function private.update_inventory_claim_appearance(
  uuid, text, integer, integer, text, text, text, text
) from public, anon, authenticated;
grant execute on function private.update_inventory_claim_appearance(
  uuid, text, integer, integer, text, text, text, text
) to authenticated;

commit;
