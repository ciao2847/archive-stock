update public.products
set price = 0
where price is null;

update public.products
set cost = 0
where cost is null;

alter table public.products
  alter column price set default 0,
  alter column price set not null,
  alter column cost set default 0,
  alter column cost set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_price_nonnegative'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_price_nonnegative check (price >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_cost_nonnegative'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_cost_nonnegative check (cost >= 0);
  end if;
end $$;
