alter table public.order_items
  add column if not exists unit_price numeric(12,2);

update public.order_items oi
set unit_price = coalesce(p.price, 0)
from public.products p
where p.id = oi.product_id
  and oi.unit_price is null;

update public.order_items
set unit_price = 0
where unit_price is null;

alter table public.order_items
  alter column unit_price set default 0,
  alter column unit_price set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'order_items_unit_price_nonnegative'
      and conrelid = 'public.order_items'::regclass
  ) then
    alter table public.order_items
      add constraint order_items_unit_price_nonnegative check (unit_price >= 0);
  end if;
end $$;
