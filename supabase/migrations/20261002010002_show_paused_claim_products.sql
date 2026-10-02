begin;

-- Keep paused listings visible on the public form so customers can understand
-- that the item existed and has closed. Availability remains enforced by
-- submit_public_claim inside the write transaction.
create or replace function public.get_public_claim_form(p_token uuid)
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
  official_line_id text,
  products jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(inventory.name, '庫藏預購'),
    form.title,
    form.description,
    form.is_open and (form.closes_at is null or form.closes_at > now()) as is_open,
    form.closes_at,
    coalesce(inventory.claim_banner_image_path, form.banner_image_path),
    coalesce(inventory.claim_banner_position_x, form.banner_position_x, 50)::smallint,
    coalesce(inventory.claim_banner_position_y, form.banner_position_y, 50)::smallint,
    coalesce(inventory.claim_theme_primary_color, form.theme_primary_color, '#5A87B1'),
    coalesce(inventory.claim_theme_background_color, form.theme_background_color, '#F3F7FB'),
    coalesce(inventory.claim_theme_surface_color, form.theme_surface_color, '#FFFFFF'),
    coalesce(inventory.claim_theme_header_text_color, form.theme_header_text_color, '#172433'),
    inventory.official_line_id,
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
              'is_enabled', listing.is_enabled,
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
