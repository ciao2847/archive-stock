begin;

-- Each inventory can explain the checkout step shown after a public claim is
-- submitted. NULL keeps the application-provided default message.
alter table public.inventory_databases
  add column if not exists claim_completion_message text null;

alter table public.inventory_databases
  drop constraint if exists inventory_databases_claim_completion_message_length;

alter table public.inventory_databases
  add constraint inventory_databases_claim_completion_message_length
  check (
    claim_completion_message is null
    or char_length(btrim(claim_completion_message)) between 1 and 1000
  );

comment on column public.inventory_databases.claim_completion_message is
  'Inventory-wide checkout instructions shown after a public claim is submitted.';

-- Payment confirmation belongs to an individual claim submission. Existing
-- submissions remain unpaid until a manager explicitly records otherwise.
alter table public.claim_submissions
  add column if not exists payment_status text not null default 'pending';

alter table public.claim_submissions
  drop constraint if exists claim_submissions_payment_status_allowed;

alter table public.claim_submissions
  add constraint claim_submissions_payment_status_allowed
  check (payment_status in ('pending', 'half_paid', 'paid'));

comment on column public.claim_submissions.payment_status is
  'Manager-recorded transfer status: pending, half_paid, or paid.';

-- Update the public LINE ID and completion instructions atomically. The
-- existing LINE updater performs authentication, inventory authorization, and
-- LINE ID validation before this function writes the message.
create or replace function private.update_inventory_claim_checkout_settings(
  p_inventory_id uuid,
  p_official_line_id text,
  p_completion_message text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_completion_message text := nullif(
    btrim(coalesce(p_completion_message, '')),
    ''
  );
begin
  perform private.update_inventory_official_line_id(
    p_inventory_id,
    p_official_line_id
  );

  if v_completion_message is not null
    and char_length(v_completion_message) > 1000
  then
    raise exception 'claim completion message is too long';
  end if;

  update public.inventory_databases inventory
  set claim_completion_message = v_completion_message,
      updated_at = now()
  where inventory.id = p_inventory_id;

  if not found then
    raise exception 'inventory database not found';
  end if;

  return p_inventory_id;
end;
$$;

revoke all on function private.update_inventory_claim_checkout_settings(
  uuid, text, text
) from public, anon, authenticated;
grant execute on function private.update_inventory_claim_checkout_settings(
  uuid, text, text
) to authenticated;

create or replace function public.update_inventory_claim_checkout_settings(
  p_inventory_id uuid,
  p_official_line_id text,
  p_completion_message text
)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.update_inventory_claim_checkout_settings(
    p_inventory_id,
    p_official_line_id,
    p_completion_message
  )
$$;

revoke all on function public.update_inventory_claim_checkout_settings(
  uuid, text, text
) from public, anon, authenticated;
grant execute on function public.update_inventory_claim_checkout_settings(
  uuid, text, text
) to authenticated;

-- Only the payment_status column is writable from the authenticated Data API.
-- RLS still limits each update to the current inventory (or an admin).
drop policy if exists "inventory members update claim payment status"
  on public.claim_submissions;

create policy "inventory members update claim payment status"
on public.claim_submissions for update to authenticated
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
)
with check (
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

revoke update on table public.claim_submissions
  from public, anon, authenticated;
grant update(payment_status) on table public.claim_submissions
  to authenticated;

-- Public forms expose the inventory-wide completion instructions. Keep paused
-- products visible while preserving their explicit availability flag.
drop function if exists public.get_public_claim_form(uuid);

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
  official_line_id text,
  completion_message text,
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
    inventory.claim_completion_message,
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
