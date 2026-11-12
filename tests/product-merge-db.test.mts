import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import type { ProductMergePreview } from "../src/lib/product-merge.ts";
const read = (path: string) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");
const uid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const migration =
  "supabase/migrations/20261106013840_merge_preorders_into_inventory.sql";
async function setup() {
  const db = new PGlite();
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

  await db.exec(`
 alter table public.products add preorder_item_name text;
 alter table public.claim_forms add title text default 'Test form';
 alter table public.claim_submission_items add product_sku text default 'SOURCE',add product_name text default 'Original preorder',add unique(submission_id,product_id);
 create table public.claim_form_products(form_id bigint references public.claim_forms(id),product_id uuid references public.products(id),sort_order int default 0,display_name text,unit_price numeric,max_quantity_per_customer int default 20,is_enabled boolean default true,primary key(form_id,product_id));
 create table public.claim_submission_payments(id bigint primary key,submission_id bigint,amount numeric,transferred_at timestamptz);
 create table public.product_location_stocks(product_id uuid references public.products(id),location_id uuid,owner_id uuid,quantity int);
 create table public.bundle_claim_order_images(id bigint generated always as identity primary key,received_product_id uuid references public.products(id));
 `);
  await db.exec(
    await read(
      "supabase/migrations/20261020033449_connect_claims_to_packing.sql",
    ),
  );
  await db.exec(await read(migration));
  await db.exec(`
 insert into public.products(id,owner_id,name,category,stock,preorder_item_name) values
 ('${uid(10)}','${uid(1)}','Preorder','poster',0,'A'),('${uid(11)}','${uid(1)}','Received','poster',5,null),
 ('${uid(12)}','${uid(2)}','Foreign','poster',5,null),('${uid(13)}','${uid(1)}','Other preorder','poster',0,'B');
 insert into public.claim_forms(owner_id,title) values('${uid(1)}','Form one'),('${uid(1)}','Form two');
 insert into public.claim_form_products(form_id,product_id,display_name,unit_price,max_quantity_per_customer,is_enabled) values
 (1,'${uid(10)}','Custom preorder title',250,9,true),(2,'${uid(10)}','Other title',300,5,true),(2,'${uid(11)}','Keep target title',400,2,false);
 insert into public.claim_submissions(form_id,nickname,phone,payment_status) values(1,'Paid customer','0912345678','paid');
 insert into public.claim_submission_items(submission_id,product_id,quantity,unit_price) values(1,'${uid(10)}',2,250);
 insert into public.claim_submission_payments values(1,1,500,'2026-11-01T12:00:00Z');
 insert into public.product_qr_labels(product_id) values('${uid(11)}');
 insert into public.product_location_stocks values('${uid(11)}',gen_random_uuid(),'${uid(1)}',5);
 insert into public.bundle_claim_payments(order_id,amount) select id,100 from public.bundle_claim_orders;
 grant select on all tables in schema public to authenticated;
 grant delete on public.products to authenticated;
 grant update on public.products,public.claim_form_products,public.claim_submission_items,public.order_items to authenticated;
 set role authenticated;
 `);
  return db;
}
async function merge(
  db: PGlite,
  token?: string,
  target = uid(11),
  source = uid(10),
  owner = uid(1),
) {
  return (
    await db.query<{ result: ProductMergePreview }>(
      "select public.merge_preorder_product($1,$2,$3,$4,$5) as result",
      [owner, source, target, token !== undefined, token ?? null],
    )
  ).rows[0].result;
}
async function rows(db: PGlite, table: string, omit: string[] = []) {
  return (
    await db.query<{ row: unknown }>(
      `select to_jsonb(t) - $1::text[] as row from public.${table} t order by to_jsonb(t)::text`,
      [omit],
    )
  ).rows.map((r) => r.row);
}
test("paid preorder merge preserves snapshots, stock, order identities and scanned progress with real source triggers", async () => {
  const db = await setup();
  try {
    await db.exec(`reset role;update public.order_items set scanned_quantity=1 where product_id='${uid(10)}';
 insert into public.packing_packages(owner_id,customer_key,customer_name,created_by) values('${uid(1)}','customer','Paid customer','${uid(1)}');
 insert into public.packing_package_items(package_id,order_id,order_item_id,product_id,quantity) select p.id,i.order_id,i.id,i.product_id,1 from public.packing_packages p cross join public.order_items i;
 insert into public.packing_scans(order_id,order_item_id,package_id,product_id,scanned_by,is_valid) select i.order_id,i.id,p.id,i.product_id,'${uid(1)}',true from public.order_items i cross join public.packing_packages p;
 set role authenticated;`);
    const before = {
      claims: await rows(db, "claim_submission_items", ["product_id"]),
      payments: await rows(db, "claim_submissions"),
      ledger: await rows(db, "claim_submission_payments"),
      labels: await rows(db, "product_qr_labels"),
      allocations: await rows(db, "product_location_stocks"),
      orders: await rows(db, "orders", ["updated_at"]),
      items: await rows(db, "order_items", ["product_id"]),
      packages: await rows(db, "packing_package_items", ["product_id"]),
      scans: await rows(db, "packing_scans", ["product_id"]),
      products: await rows(db, "products"),
    };
    const preview = await merge(db);
    assert.equal(preview.submissionCount, 1);
    assert.equal(preview.fulfillmentCount, 1);
    assert.equal(preview.forms.length, 2);
    assert.equal(preview.forms[1].targetAlreadyListed, true);
    assert.equal(preview.target.stock, 5);
    assert.deepEqual(preview.conflicts, []);
    assert.equal(preview.merged, false);
    assert.deepEqual(await rows(db, "products"), before.products);
    const result = await merge(db, preview.token);
    assert.equal(result.merged, true);
    assert.deepEqual(
      await rows(db, "claim_submission_items", ["product_id"]),
      before.claims,
    );
    assert.deepEqual(await rows(db, "claim_submissions"), before.payments);
    assert.deepEqual(
      await rows(db, "claim_submission_payments"),
      before.ledger,
    );
    assert.deepEqual(await rows(db, "product_qr_labels"), before.labels);
    assert.deepEqual(
      await rows(db, "product_location_stocks"),
      before.allocations,
    );
    assert.deepEqual(await rows(db, "orders", ["updated_at"]), before.orders);
    assert.deepEqual(
      await rows(db, "order_items", ["product_id"]),
      before.items,
    );
    assert.deepEqual(
      await rows(db, "packing_package_items", ["product_id"]),
      before.packages,
    );
    assert.deepEqual(
      await rows(db, "packing_scans", ["product_id"]),
      before.scans,
    );
    const products = (
      await db.query<{
        id: string;
        stock: number;
        merged_into_product_id: string;
      }>(
        "select id,stock,merged_into_product_id from public.products order by id",
      )
    ).rows;
    assert.equal(products[0].stock, 0);
    assert.equal(products[0].merged_into_product_id, uid(11));
    assert.equal(products[1].stock, 5);
    for (const table of [
      "claim_submission_items",
      "order_items",
      "packing_package_items",
      "packing_scans",
    ])
      assert.equal(
        (
          await db.query<{ product_id: string }>(
            `select product_id from public.${table}`,
          )
        ).rows[0].product_id,
        uid(11),
      );
    const listings = (
      await db.query<{
        form_id: number;
        display_name: string;
        unit_price: string;
      }>(
        "select form_id,display_name,unit_price from public.claim_form_products order by form_id",
      )
    ).rows;
    assert.deepEqual(listings, [
      { form_id: 1, display_name: "Custom preorder title", unit_price: "250" },
      { form_id: 2, display_name: "Keep target title", unit_price: "400" },
    ]);
    await assert.rejects(merge(db, preview.token), /product already merged/);
    for (const sql of [
      `update public.products set stock=1 where id='${uid(10)}'`,
      `delete from public.products where id='${uid(10)}'`,
      `update public.claim_form_products set product_id='${uid(10)}' where form_id=1`,
      `update public.claim_submission_items set product_id='${uid(10)}' where submission_id=1`,
    ])
      await assert.rejects(db.exec(sql), /product already merged/);
    // Future payment reconciliation must still accept the locked projection.
    await db.exec(
      "reset role;update public.claim_submissions set payment_status='pending' where id=1;update public.claim_submissions set payment_status='paid' where id=1",
    );
    assert.equal(
      (
        await db.query<{ stock: number }>(
          `select stock from public.products where id='${uid(11)}'`,
        )
      ).rows[0].stock,
      5,
    );
  } finally {
    await db.close();
  }
});
test("merge validates tenants, physical receipt, conflicts, stale preview and atomic rollback", async () => {
  const db = await setup();
  try {
    await assert.rejects(
      merge(db, undefined, uid(12)),
      /merge product not found/,
    );
    await assert.rejects(
      merge(db, undefined, uid(11), uid(10), uid(2)),
      /owner access required/,
    );
    await assert.rejects(merge(db, undefined, uid(10)), /invalid merge pair/);
    await assert.rejects(
      merge(db, undefined, uid(13)),
      /target is not received product/,
    );
    await assert.rejects(
      merge(db, undefined, uid(10), uid(11)),
      /source is not unreceived preorder/,
    );
    await db.exec(
      `reset role;insert into public.product_qr_labels(product_id) values('${uid(10)}');set role authenticated`,
    );
    await assert.rejects(merge(db), /source is not unreceived preorder/);
    await db.exec(
      `reset role;delete from public.product_qr_labels where product_id='${uid(10)}';set role authenticated`,
    );
    // Both execution surfaces require authentication; no anonymous definer API.
    const privileges = (
      await db.query<{ public_anon: boolean; private_anon: boolean }>(
        `select has_function_privilege('anon','public.merge_preorder_product(uuid,uuid,uuid,boolean,text)','execute') as public_anon,has_function_privilege('anon','private.merge_preorder_product(uuid,uuid,uuid,boolean,text)','execute') as private_anon`,
      )
    ).rows[0];
    assert.deepEqual(privileges, { public_anon: false, private_anon: false });
    await assert.rejects(
      db.exec(
        `update public.products set merged_into_product_id='${uid(11)}',merged_at=now(),merged_by='${uid(1)}' where id='${uid(13)}'`,
      ),
      /use product merge operation/,
    );
    const initial = await merge(db);
    await db.exec(
      "reset role;update public.claim_submission_items set quantity=3 where submission_id=1;set role authenticated",
    );
    await assert.rejects(merge(db, initial.token), /merge preview changed/);
    await db.exec(
      `reset role;insert into public.claim_submission_items(submission_id,product_id,quantity,unit_price) values(1,'${uid(11)}',1,450);set role authenticated`,
    );
    const conflict = await merge(db);
    assert.ok(conflict.conflicts.some((c) => c.kind === "claim"));
    assert.ok(conflict.conflicts.some((c) => c.kind === "order"));
    await assert.rejects(merge(db, conflict.token), /merge order conflict/);
    assert.equal(
      (
        await db.query<{ product_id: string }>(
          "select product_id from public.claim_submission_items order by id",
        )
      ).rows[0].product_id,
      uid(10),
    );
    await db.exec(`reset role;delete from public.claim_submission_items where product_id='${uid(11)}';
 create function private.test_reject_merge() returns trigger language plpgsql as $$begin if new.merged_into_product_id is not null then raise exception 'forced failure';end if;return new;end$$;
 create trigger reject_merge before update on public.products for each row execute function private.test_reject_merge();set role authenticated;`);
    const preview = await merge(db);
    const before = await rows(db, "claim_form_products");
    await assert.rejects(merge(db, preview.token), /forced failure/);
    assert.deepEqual(await rows(db, "claim_form_products"), before);
    assert.equal(
      (
        await db.query<{ product_id: string }>(
          "select product_id from public.order_items",
        )
      ).rows[0].product_id,
      uid(10),
    );
    await db.exec(
      `reset role;select set_config('request.jwt.claim.sub','',false);set role authenticated;`,
    );
    await assert.rejects(merge(db), /employee access required/);
    await db.exec("reset role;set role anon");
    await assert.rejects(merge(db), /permission denied/);
  } finally {
    await db.close();
  }
});
