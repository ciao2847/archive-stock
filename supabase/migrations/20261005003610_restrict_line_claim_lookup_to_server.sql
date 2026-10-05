begin;

-- Customer phone lookups are performed only by the verified LINE webhook.
-- The server uses a Supabase Secret Key (service_role), so this function no
-- longer needs elevated definer privileges or access from public API roles.
alter function public.query_customer_claims_summary(text, uuid)
  security invoker;

revoke all on function public.query_customer_claims_summary(text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.query_customer_claims_summary(text, uuid)
  to service_role;

notify pgrst, 'reload schema';

commit;
