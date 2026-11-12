import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
const read = (path: string) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");
test("claim and bundle orders reuse real packing functions without double counting or consuming stock on conversion", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth; create schema private;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create table auth.users(id uuid primary key);
`);
    let legacy = await read("supabase/legacy/schema.sql");
    legacy = legacy.replace("create extension if not exists pgcrypto;", "");
    // Only bootstrap original table definitions; policies below are Supabase-specific.
    legacy = legacy.slice(
      0,
      legacy.indexOf("create or replace function public.my_role()"),
    );
    await db.exec(legacy);
    await db.exec(`
create table public.inventory_databases(id uuid primary key);
alter table public.profiles add inventory_owner_id uuid references public.inventory_databases(id);
alter table public.products add owner_id uuid references public.inventory_databases(id);
alter table public.customers add owner_id uuid references public.inventory_databases(id), add nickname text, add created_by uuid;
alter table public.orders add owner_id uuid references public.inventory_databases(id), add created_by uuid, add deleted_at timestamptz, add sales_channel text default 'direct', add discount numeric default 0, add shipping_income numeric default 0, add platform_fee numeric default 0, add seller_shipping_cost numeric default 0;
alter table public.order_items add unit_price numeric default 0;
alter table public.packing_scans add scan_method text default 'qr';
create table public.product_qr_labels(id uuid primary key default gen_random_uuid(), product_id uuid references public.products(id), token uuid default gen_random_uuid(), status text default 'active', used_order_id uuid, used_by uuid, used_at timestamptz, created_at timestamptz default now());
create table public.settlement_orders(order_id uuid references public.orders(id));
create function public.my_role() returns public.user_role language sql stable security definer set search_path='' as $$select role from public.profiles where id=auth.uid()$$;
create function private.current_inventory_owner_id() returns uuid language sql stable security definer set search_path='' as $$select inventory_owner_id from public.profiles where id=auth.uid()$$;
create table public.claim_forms(id bigint primary key generated always as identity, owner_id uuid references public.inventory_databases(id));
create table public.claim_submissions(id bigint primary key generated always as identity, form_id bigint references public.claim_forms(id), confirmation_code text unique default ('PRE-'||gen_random_uuid()), nickname text, phone text, notes text, payment_status text default 'pending', created_at timestamptz default now());
create table public.claim_submission_items(id bigint primary key generated always as identity, submission_id bigint references public.claim_submissions(id) on delete cascade, product_id uuid references public.products(id) on delete set null, quantity integer, unit_price numeric);
create table public.bundle_claim_orders(id bigint primary key generated always as identity, owner_id uuid references public.inventory_databases(id), confirmation_code text unique default ('HD-'||gen_random_uuid()), customer_nickname text, customer_phone text, customer_notes text, confirmed_at timestamptz default now(), total_amount numeric, status text default 'draft', receiving_checked_at timestamptz, receiving_checked_by uuid, outbound_checked_at timestamptz, outbound_checked_by uuid);
create table public.bundle_claim_payments(id bigint primary key generated always as identity, order_id bigint references public.bundle_claim_orders(id), amount numeric);
grant usage on schema public,private,auth to authenticated;
grant select on all tables in schema public to authenticated;
insert into auth.users values ('00000000-0000-4000-8000-000000000001');
insert into public.inventory_databases values ('00000000-0000-4000-8000-000000000001'), ('00000000-0000-4000-8000-000000000002');
insert into public.profiles(id,display_name,inventory_owner_id) values ('00000000-0000-4000-8000-000000000001','Tester','00000000-0000-4000-8000-000000000001');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
`);
    await db.exec(
      await read(
        "supabase/migrations/20260910031116_customer_centered_packing.sql",
      ),
    );
    // Use the exact production customer identity definition.
    const identity = await read(
      "supabase/migrations/20260910035626_normalize_packing_customer_identity.sql",
    );
    await db.exec(
      identity.slice(
        identity.indexOf("create or replace function"),
        identity.indexOf("-- Earlier package records"),
      ),
    );
    // Pre-migration source verifies backfill, including an unarrived product.
    await db.exec(
      `insert into public.products(id,owner_id,name,category,stock) values ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000001','Poster','poster',0); insert into public.claim_forms(owner_id) values ('00000000-0000-4000-8000-000000000001'); insert into public.claim_submissions(form_id,confirmation_code,nickname,phone) values (1,'PRE-EXISTING','小美','0912345678'); insert into public.claim_submission_items(submission_id,product_id,quantity,unit_price) values (1,'00000000-0000-4000-8000-000000000010',2,300); insert into public.bundle_claim_orders(owner_id,total_amount,status,customer_nickname,customer_phone,outbound_checked_at) values ('00000000-0000-4000-8000-000000000001',600,'confirmed','歷史客人','0999999999',now());`,
    );
    await db.exec(
      await read(
        "supabase/migrations/20261020033449_connect_claims_to_packing.sql",
      ),
    );
    await db.exec(await read("supabase/tests/claim_fulfillment.test.sql"));
    // Receipt uses the real product creation RPC, source projection and packing
    // functions, with only Storage metadata bootstrapped locally.
    await db.exec(`
      create schema storage;
      create table storage.objects(bucket_id text, name text, unique(bucket_id,name));
      alter table public.products add description text;
      alter table public.locations add owner_id uuid;
      alter table public.product_qr_labels add batch_code text;
      alter table public.bundle_claim_orders add title text default '十月份客訂', add updated_at timestamptz default now();
      create table public.bundle_claim_order_images(
        id bigint primary key generated always as identity,
        order_id bigint not null references public.bundle_claim_orders(id) on delete cascade,
        sort_order integer default 0, storage_path text not null,
        product_name text, product_amount numeric(12,2)
      );
    `);
    const bundleMigration = await read(
      "supabase/migrations/20261005055252_add_single_poster_bundle_claims.sql",
    );
    await db.exec(
      bundleMigration.slice(
        bundleMigration.indexOf(
          "create or replace function private.can_manage_bundle_inventory(",
        ),
        bundleMigration.indexOf(
          'create policy "inventory members read bundle claim orders"',
        ),
      ),
    );
    await db.exec(
      bundleMigration.slice(
        bundleMigration.indexOf(
          "create or replace function private.assert_bundle_inventory_access(",
        ),
        bundleMigration.indexOf(
          "create or replace function private.create_bundle_claim_order(",
        ),
      ),
    );
    await db.exec(
      bundleMigration.slice(
        bundleMigration.indexOf(
          "create or replace function private.set_bundle_claim_receiving_check(",
        ),
        bundleMigration.indexOf(
          "create or replace function private.set_bundle_claim_outbound_check(",
        ),
      ),
    );
    await db.exec(
      await read(
        "supabase/migrations/20261008020858_simplify_product_intake.sql",
      ),
    );
    await db.exec(
      await read(
        "supabase/migrations/20261102090000_receive_bundle_products_into_inventory.sql",
      ),
    );
    await db.exec(
      await read("supabase/tests/bundle_receiving_inventory.test.sql"),
    );
  } finally {
    await db.close();
  }
});
