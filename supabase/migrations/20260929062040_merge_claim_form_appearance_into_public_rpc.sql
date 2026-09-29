begin;

-- Return appearance with the existing public payload. This keeps the public
-- surface to one intentionally anonymous SECURITY DEFINER function instead of
-- introducing a second callable function with the same access model.
drop function public.get_public_claim_form_appearance(uuid);
drop function public.get_public_claim_form(uuid);

create function public.get_public_claim_form(p_token uuid)
returns table(
  store_name text,
  title text,
  description text,
  is_open boolean,
  closes_at timestamptz,
  banner_image_path text,
  theme_primary_color text,
  theme_background_color text,
  theme_surface_color text,
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
    form.theme_primary_color,
    form.theme_background_color,
    form.theme_surface_color,
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
