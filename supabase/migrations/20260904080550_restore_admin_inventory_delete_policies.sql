begin;

-- Restore policies omitted while the tenant-scoped policies were rebuilt.
drop policy if exists "admins delete products" on public.products;
create policy "admins delete products"
on public.products for delete to authenticated
using ((select public.my_role()) = 'admin');

drop policy if exists "admins delete locations" on public.locations;
create policy "admins delete locations"
on public.locations for delete to authenticated
using ((select public.my_role()) = 'admin');

notify pgrst, 'reload schema';
commit;
