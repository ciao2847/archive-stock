begin;

-- Public listing names belong to the form and may differ from inventory names.
drop trigger if exists enforce_preorder_listing_name on public.claim_form_products;
drop function if exists private.enforce_preorder_listing_name();

-- Keep inherited names in sync while preserving explicitly customized listings.
create or replace function private.sync_preorder_listing_names()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.claim_form_products
  set display_name = new.name
  where product_id = new.id
    and display_name = old.name;
  return new;
end;
$$;

notify pgrst, 'reload schema';
commit;
