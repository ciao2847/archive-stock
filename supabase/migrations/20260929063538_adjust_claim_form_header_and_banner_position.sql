begin;

alter table public.claim_forms
  add column banner_position_x smallint not null default 50,
  add column banner_position_y smallint not null default 50,
  add column theme_header_text_color text not null default '#172433';

alter table public.claim_forms
  add constraint claim_forms_banner_position_x_range
    check (banner_position_x between 0 and 100),
  add constraint claim_forms_banner_position_y_range
    check (banner_position_y between 0 and 100),
  add constraint claim_forms_theme_header_text_color_format
    check (theme_header_text_color ~ '^#[0-9A-Fa-f]{6}$');

-- Preserve the previous automatic white text behaviour for uploaded banners.
update public.claim_forms
set theme_header_text_color = '#FFFFFF',
    updated_at = now()
where banner_image_path is not null;

-- Lighten only forms that still use the original 小天地 preset. This avoids
-- overwriting a colour scheme an inventory user has already customised.
update public.claim_forms form
set theme_primary_color = '#425F8F',
    theme_background_color = '#E8EDF6',
    theme_surface_color = '#FFF9EE',
    theme_header_text_color = '#FFF9EE',
    updated_at = now()
from public.inventory_databases inventory
where inventory.id = form.owner_id
  and inventory.name = '海報小天地'
  and upper(form.theme_primary_color) = '#17345F'
  and upper(form.theme_background_color) = '#10264A'
  and upper(form.theme_surface_color) = '#F7F1E7';

-- Keep the previous RPC available during a rolling frontend deployment and
-- add the new appearance fields through a larger, unambiguous overload.
create or replace function public.configure_claim_form(
  p_form_id bigint,
  p_owner_id uuid,
  p_title text,
  p_description text,
  p_is_open boolean,
  p_closes_at timestamptz,
  p_products jsonb,
  p_banner_image_path text,
  p_banner_position_x integer,
  p_banner_position_y integer,
  p_theme_primary_color text,
  p_theme_background_color text,
  p_theme_surface_color text,
  p_theme_header_text_color text
)
returns table(form_id bigint, public_token uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_form_id bigint;
  v_public_token uuid;
begin
  if p_banner_position_x is null
    or p_banner_position_x not between 0 and 100
    or p_banner_position_y is null
    or p_banner_position_y not between 0 and 100
  then
    raise exception 'invalid claim form banner position';
  end if;

  if p_theme_header_text_color is null
    or p_theme_header_text_color !~ '^#[0-9A-Fa-f]{6}$'
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
    p_products,
    p_banner_image_path,
    p_theme_primary_color,
    p_theme_background_color,
    p_theme_surface_color
  ) configured;

  update public.claim_forms form
  set banner_position_x = p_banner_position_x,
      banner_position_y = p_banner_position_y,
      theme_header_text_color = upper(p_theme_header_text_color),
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
  text, integer, integer, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.configure_claim_form(
  bigint, uuid, text, text, boolean, timestamptz, jsonb,
  text, integer, integer, text, text, text, text
) to authenticated;

drop function public.get_public_claim_form(uuid);

create function public.get_public_claim_form(p_token uuid)
returns table(
  store_name text,
  title text,
  description text,
  is_open boolean,
  closes_at timestamptz,
  banner_image_path text,
  banner_position_x smallint,
  banner_position_y smallint,
  theme_primary_color text,
  theme_background_color text,
  theme_surface_color text,
  theme_header_text_color text,
  products jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(inventory.name, '喊單表單') as store_name,
    form.title,
    form.description,
    form.is_open and (form.closes_at is null or form.closes_at > now())
      as is_open,
    form.closes_at,
    form.banner_image_path,
    form.banner_position_x,
    form.banner_position_y,
    form.theme_primary_color,
    form.theme_background_color,
    form.theme_surface_color,
    form.theme_header_text_color,
    coalesce(
      (
        select jsonb_agg(listed_product.payload order by
          listed_product.sort_order,
          listed_product.published_at desc,
          listed_product.product_name
        )
        from (
          select
            listing.sort_order,
            listing.published_at,
            listing.display_name as product_name,
            jsonb_build_object(
              'id', product.id,
              'sku', product.sku,
              'name', listing.display_name,
              'work', work.title_zh,
              'category', product.category,
              'country', product.country,
              'source', product.source,
              'description', product.description,
              'price', listing.unit_price,
              'image_path', coalesce(
                product.image_paths[2],
                product.image_paths[1]
              ),
              'poster_format', product.poster_format,
              'poster_size', product.poster_size,
              'poster_crafts', coalesce(product.poster_crafts, '{}'),
              'release_date', product.release_date,
              'published_at', listing.published_at,
              'max_quantity', listing.max_quantity_per_customer
            ) as payload
          from public.claim_form_products listing
          join public.products product on product.id = listing.product_id
          left join public.works work on work.id = product.work_id
          where listing.form_id = form.id
        ) listed_product
      ),
      '[]'::jsonb
    ) as products
  from public.claim_forms form
  left join public.inventory_databases inventory
    on inventory.id = form.owner_id
  where form.public_token = p_token;
$$;

revoke all on function public.get_public_claim_form(uuid)
  from public, anon, authenticated;
grant execute on function public.get_public_claim_form(uuid)
  to anon, authenticated;

notify pgrst, 'reload schema';

commit;
