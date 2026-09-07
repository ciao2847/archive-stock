## 1. Database Schema & Initial Migration

- [x] 1.1 Add `inventory_owner_id` to `public.profiles` and create index. Verify by checking table definition.
- [x] 1.2 Create `public.inventory_databases` and `public.inventory_database_members` tables. Verify by checking table definitions.
- [x] 1.3 Create `private.current_inventory_owner_id()` function and grant usage to `authenticated`. Verify by calling it as an authenticated user.
- [x] 1.4 Populate initial inventory databases and memberships based on the requested mapping (Pennie/Cazzo, Wen/Sheree). Verify by querying membership tables.
- [x] 1.5 Migrate existing products, orders, and other records to point to the new `inventory_owner_id`. Verify data consistency with a query.

## 2. Backend Functions & API

- [x] 2.1 Implement `public.update_inventory_database_access` RPC function for admins to manage databases. Verify by calling as admin and checking results.
- [x] 2.2 Update `public.create_inventory_product` to respect the `inventory_owner_id`. Verify by creating a product and checking its `owner_id`.
- [x] 2.3 Update other relevant RPC functions (e.g., order creation) to use the scoped context. Verify with integration tests.

## 3. RLS Policy Updates

- [x] 3.1 Update RLS policies for `public.products` to scope by `private.current_inventory_owner_id()`. Verify by querying as different users.
- [x] 3.2 Update RLS policies for `public.orders` to scope by `private.current_inventory_owner_id()`. Verify isolation.
- [x] 3.3 Update RLS policies for `public.customers` and `public.locations` to scope by `private.current_inventory_owner_id()`. Verify isolation.
- [x] 3.4 Update RLS policies for `public.settlements` to scope by `private.current_inventory_owner_id()`. Verify isolation.

## 4. Verification & Testing

- [x] 4.1 Create a new automated test file `supabase/tests/multi_tenant_isolation.test.sql` to verify that users in different databases cannot see each other's data. Verify by running the test.
- [x] 4.2 Verify that an admin can correctly rename a database and reassign users using the provided RPC functions. Verify by manual test or script.
