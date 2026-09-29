begin;

-- The banner form shown by the user had already changed only its page
-- background to this muted purple. Move that remaining legacy combination to
-- the brighter 小天地 preset without touching unrelated custom themes.
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
  and upper(form.theme_background_color) = '#6468A0'
  and upper(form.theme_surface_color) = '#F7F1E7';

commit;
