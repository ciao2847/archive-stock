begin;

-- PostgreSQL table privileges are evaluated before RLS. Grant the signed-in
-- application role access to each table used by the Data API and invoker RPCs;
-- the existing RLS policies remain responsible for row-level authorization.
grant usage on schema public to authenticated;

grant select on table public.profiles to authenticated;

grant select, insert, update, delete on table
  public.works,
  public.locations,
  public.products,
  public.location_movements,
  public.customers,
  public.orders,
  public.order_items,
  public.packing_scans,
  public.product_qr_labels,
  public.settlements,
  public.settlement_orders,
  public.settlement_products
to authenticated;

notify pgrst, 'reload schema';

commit;
