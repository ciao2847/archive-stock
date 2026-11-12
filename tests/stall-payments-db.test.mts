import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const owner = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const product = "00000000-0000-4000-8000-000000000010";
const tokens = [20, 21, 22].map(
  (n) => `00000000-0000-4000-8000-0000000000${n}`,
);
test("checkout discount and method commit with stock, replay safely, edit net totals and respect settlement locks", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
 create role authenticated;create role anon;create schema auth;create schema private;
 create function auth.uid() returns uuid language sql as $$ select '${owner}'::uuid $$;
 create function public.my_role() returns text language sql as $$select 'staff'$$;
 create function private.current_inventory_owner_id() returns uuid language sql as $$select '${owner}'::uuid$$;
 create type public.product_status as enum ('in_stock','packed','reserved');
 create table public.products(id uuid primary key,owner_id uuid,name text,sku text,price numeric,stock int,status public.product_status default 'in_stock',updated_at timestamptz);
 create table public.orders(id uuid primary key default gen_random_uuid(),owner_id uuid,order_no text default gen_random_uuid()::text,status text default 'pending',payment_status text,discount numeric default 0,notes text,deleted_at timestamptz,created_at timestamptz default now(),updated_at timestamptz,packed_at timestamptz,packed_by uuid);
 create table public.order_items(id uuid primary key default gen_random_uuid(),order_id uuid references public.orders,product_id uuid references public.products,quantity int,unit_price numeric,packed_quantity int default 0,scanned_quantity int default 0);
 create table public.product_qr_labels(id uuid primary key default gen_random_uuid(),token uuid unique,product_id uuid,status text default 'active',used_order_id uuid,used_by uuid,used_at timestamptz);
 create table public.settlements(owner_id uuid,period_start date,period_end date);
 create table public.settlement_orders(order_id uuid);
 create table public.packing_package_items(order_id uuid);
 create table public.packing_scans(order_id uuid);
 -- Bootstrap order creation only; checkout, editing, cancellation and history use actual migrations.
 create function public.create_order_with_items(text,text,text,text,text,text,numeric,numeric,numeric,numeric,jsonb)
 returns uuid language plpgsql as $$declare oid uuid;begin
 insert into public.orders(owner_id,payment_status,notes,discount) values('${owner}',$4,$5,$7) returning id into oid;
 insert into public.order_items(order_id,product_id,quantity,unit_price) select oid,x.product_id,x.quantity,x.unit_price from jsonb_to_recordset($11) x(product_id uuid,quantity int,unit_price numeric);
 return oid;end;$$;
 insert into public.products(id,owner_id,name,sku,price,stock) values('${product}','${owner}','Poster','A000001',200,3);
 insert into public.product_qr_labels(token,product_id) values ${tokens.map((t) => `('${t}','${product}')`).join(",")};
 `);
    await db.exec(
      await readFile(
        "supabase/migrations/20261014002007_add_stall_checkout.sql",
        "utf8",
      ),
    );
    await db.exec(
      await readFile(
        "supabase/migrations/20261016054914_manage_stall_checkout_orders.sql",
        "utf8",
      ),
    );
    await db.exec(
      await readFile(
        "supabase/migrations/20261105075823_stall_checkout_discounts_and_payments.sql",
        "utf8",
      ),
    );
    // Run with the same invoker role and tenant visibility as the application.
    await db.exec(`grant usage on schema public,private,auth to authenticated; grant select,insert,update,delete on all tables in schema public to authenticated;
 alter table public.orders enable row level security;create policy tenant on public.orders to authenticated using(owner_id='${owner}') with check(owner_id='${owner}');
 alter table public.products enable row level security;create policy tenant on public.products to authenticated using(owner_id='${owner}') with check(owner_id='${owner}');
 set role authenticated;`);
    const checkout = async (
      discount: number,
      method = "cash",
      token = tokens[0],
      tenant = owner,
    ) =>
      (
        await db.query<{
          receipt: {
            orderId: string;
            total: number;
            discount: number;
            paymentMethod: string;
          };
        }>(
          `select public.checkout_stall_labels($1,array[$2::uuid],350,$3,$4) receipt`,
          [tenant, token, discount, method],
        )
      ).rows[0].receipt;
    await assert.rejects(checkout(351), /invalid checkout discount/);
    await assert.rejects(checkout(-1), /invalid checkout discount/);
    await assert.rejects(checkout(0.001), /invalid checkout discount/);
    await assert.rejects(
      checkout(0, "invalid"),
      /invalid checkout payment method/,
    );
    await assert.rejects(
      checkout(0, "cash", tokens[0], other),
      /owner access required/,
    );
    assert.equal(
      (await db.query<{ stock: number }>(`select stock from public.products`))
        .rows[0].stock,
      3,
    );
    const receipt = await checkout(50, "transfer");
    assert.equal(receipt.total, 300);
    assert.equal(receipt.discount, 50);
    assert.equal(receipt.paymentMethod, "transfer");
    const retry = await checkout(0, "cash");
    assert.deepEqual(retry, receipt);
    assert.equal(
      (await db.query<{ stock: number }>(`select stock from public.products`))
        .rows[0].stock,
      2,
    );
    const history = async () =>
      (
        await db.query<{
          result: {
            orders: Array<{
              total: number;
              discount: number;
              paymentMethod: string;
            }>;
          };
        }>(`select public.find_stall_orders($1) result`, [owner])
      ).rows[0].result.orders[0];
    assert.equal((await history()).total, 300);
    const items = JSON.stringify([
      { product_id: product, quantity: 1, unit_price: 350 },
    ]);
    const edit = async (discount: number, revision = 0) =>
      db.query(
        `select public.manage_stall_order($1,$2,$3,'edit',$4::jsonb,'test',$5,'card')`,
        [owner, receipt.orderId, revision, items, discount],
      );
    await assert.rejects(edit(351), /invalid checkout discount/);
    await edit(100);
    assert.equal((await history()).total, 250);
    assert.equal((await history()).paymentMethod, "card");
    await assert.rejects(edit(0), /stall order changed/);
    // Older editors preserve recorded discount and method.
    await db.query(
      `select public.manage_stall_order($1,$2,1,'edit',$3::jsonb,'legacy edit')`,
      [owner, receipt.orderId, items],
    );
    assert.equal((await history()).discount, 100);
    assert.equal((await history()).total, 250);
    await db.query(
      `insert into public.settlement_orders(order_id) values($1)`,
      [receipt.orderId],
    );
    await assert.rejects(edit(0, 2), /settled order cannot be changed/);
    await db.query(`delete from public.settlement_orders`);
    await db.query(`select public.manage_stall_order($1,$2,2,'cancel')`, [
      owner,
      receipt.orderId,
    ]);
    await db.query(`select public.manage_stall_order($1,$2,2,'cancel')`, [
      owner,
      receipt.orderId,
    ]);
    assert.equal(
      (await db.query<{ stock: number }>(`select stock from public.products`))
        .rows[0].stock,
      3,
    );
    // Zero balance is a valid recorded sale, and original clients still work.
    assert.equal((await checkout(350, "other", tokens[1])).total, 0);
    const legacy = (
      await db.query<{ r: { total: number; paymentMethod: string } }>(
        `select public.checkout_stall_labels($1,array[$2::uuid],350) r`,
        [owner, tokens[2]],
      )
    ).rows[0].r;
    assert.equal(legacy.total, 350);
    assert.equal(legacy.paymentMethod, "cash");
  } finally {
    await db.close();
  }
});
