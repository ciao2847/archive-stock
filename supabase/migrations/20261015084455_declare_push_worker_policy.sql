begin;
-- Queue credentials and delivery attempts belong exclusively to the server
-- worker. No client role has table grants or a matching policy.
create policy "server worker manages push deliveries"
on public.order_push_deliveries for all to service_role
using (true) with check (true);
commit;
