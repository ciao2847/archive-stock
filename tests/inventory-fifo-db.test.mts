import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const uid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const read = (path: string) => readFile(path, "utf8");
async function setup(canonicalNames = false) {
  const db = new PGlite();
  await db.exec(`
create role authenticated; create role anon; create schema private; create schema auth; create schema storage;
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function private.current_inventory_owner_id() returns uuid language sql as $$select '${uid(1)}'::uuid$$;
grant usage on schema private,auth to authenticated;
create table public.inventory_databases(id uuid primary key,name text);
create table public.profiles(id uuid primary key, role text not null default 'staff');
create function public.my_role() returns text language sql security definer set search_path='' as $$select coalesce(nullif(current_setting('test.role',true),''),(select role from public.profiles where id=auth.uid()),'staff')$$;
create table public.products(id uuid primary key,owner_id uuid,sku text,name text,stock int not null default 0);
create table public.customers(id uuid primary key,name text,nickname text);
create table public.orders(id uuid primary key,owner_id uuid,customer_id uuid,order_no text,status text,deleted_at timestamptz,packed_at timestamptz,created_at timestamptz default now(),discount numeric default 0,shipping_income numeric default 0);
create table public.order_items(id uuid primary key,order_id uuid,product_id uuid,quantity integer,packed_quantity integer default 0,unit_price numeric);
create table public.settlements(id uuid primary key default gen_random_uuid(),settlement_no text default 'S-TEST',owner_id uuid,period_start date,period_end date,revenue numeric,cost numeric,profit numeric generated always as(revenue-cost) stored,created_by uuid,cost_source text default 'legacy_product');
create table public.settlement_orders(settlement_id uuid,order_id uuid unique,revenue numeric);
create table public.settlement_products(id uuid);
create table storage.objects(bucket_id text,name text);
insert into public.inventory_databases values('${uid(1)}','${canonicalNames ? "NN佛系海報代購" : "佛系代購"}'),('${uid(9)}','${canonicalNames ? "海報小天地" : "小天地"}');
insert into public.profiles(id) values('${uid(2)}');
insert into public.profiles(id,role) values('${uid(3)}','admin');
insert into public.products values('${uid(10)}','${uid(1)}','A001','商品',10),('${uid(11)}','${uid(9)}','A002','小天地商品',10);
grant select on all tables in schema public to authenticated;
grant update on public.products,public.orders,public.order_items to authenticated;
grant insert,delete on public.order_items to authenticated;
grant insert on public.orders to authenticated;
select set_config('request.jwt.claim.sub','${uid(2)}',false);
`);
  const base = await read(
    "supabase/migrations/20261008004748_calculator_period_accounting.sql",
  );
  await db.exec(
    base.slice(
      base.indexOf("create table public.financial_period_costs"),
      base.indexOf("alter table public.settlements"),
    ),
  );
  await db.exec(
    base.slice(
      base.indexOf("create function private.guard_period_cost()"),
      base.indexOf("create function public.get_financial_period_preview"),
    ),
  );
  await db.exec(
    await read(
      "supabase/migrations/20261008014308_poster_revenue_settlement.sql",
    ),
  );
  await db.exec(
    base.slice(
      base.indexOf("revoke insert, update on public.settlements"),
      base.indexOf("-- Disable legacy product-cost writes"),
    ),
  );
  await db.exec(
    await read(
      "supabase/migrations/20261021083916_itemized_costs_and_profit_sharing.sql",
    ),
  );
  await db.exec(
    await read(
      "supabase/migrations/20261112013316_inventory_fifo_cost_accounting.sql",
    ),
  );
  await db.exec("set role authenticated");
  return db;
}
async function batches(db: PGlite) {
  return (
    await db.query<{
      r: {
        mode: string;
        batches: Array<{
          id: string;
          quantity: number;
          remaining: number;
          unit_cost: number | null;
          revision: number;
          locked: boolean;
        }>;
      };
    }>(`select public.get_inventory_product_costs('${uid(10)}') r`)
  ).rows[0].r.batches;
}
async function setCost(db: PGlite, index: number, cost: number) {
  const batch = (await batches(db))[index];
  await db.query("select public.save_inventory_batch_cost($1,$2,'', $3)", [
    batch.id,
    cost,
    batch.revision,
  ]);
}
async function preview(db: PGlite) {
  return (
    await db.query<{
      r: {
        accounting_mode: string;
        product_cost: number;
        product_cost_details: unknown[];
        missing_costs: unknown[];
        settled: boolean;
      };
    }>(
      `select public.get_financial_period_preview('${uid(1)}','2026-11-01','2026-12-31') r`,
    )
  ).rows[0].r;
}
async function sell(db: PGlite, quantity: number, id = 20) {
  await db.exec(`begin;
insert into public.orders(id,owner_id,order_no,status,packed_at) values('${uid(id)}','${uid(1)}','O-${id}','packed','2026-11-12');
insert into public.order_items values('${uid(id + 100)}','${uid(id)}','${uid(10)}',${quantity},${quantity},300);
update public.products set stock=stock-${quantity} where id='${uid(10)}';
commit;`);
}
test("FIFO spans batches, restores original costs on edits/cancel, and rejects cross-tenant writes", async () => {
  const db = await setup();
  try {
    assert.equal((await batches(db))[0].unit_cost, null);
    await setCost(db, 0, 180);
    await db.exec(`update public.products set stock=20 where id='${uid(10)}'`);
    await setCost(db, 1, 200);
    await sell(db, 12);
    assert.equal((await preview(db)).product_cost, 2200);
    assert.deepEqual(
      (await batches(db)).map((b) => b.remaining),
      [0, 8],
    );
    await db.exec(
      `begin;update public.products set stock=stock+3 where id='${uid(10)}';update public.order_items set quantity=9,packed_quantity=9 where id='${uid(120)}';commit;`,
    );
    assert.equal((await preview(db)).product_cost, 1620);
    assert.deepEqual(
      (await batches(db)).map((b) => b.remaining),
      [1, 10],
    );
    await db.exec(
      `begin;update public.products set stock=stock+9 where id='${uid(10)}';update public.order_items set packed_quantity=0 where id='${uid(120)}';update public.orders set status='cancelled' where id='${uid(20)}';commit;`,
    );
    assert.deepEqual(
      (await batches(db)).map((b) => b.remaining),
      [10, 10],
    );
    assert.equal((await batches(db)).length, 2);
    await assert.rejects(
      db.query(`select public.get_inventory_product_costs('${uid(11)}')`),
      /owner access required/,
    );
    await assert.rejects(
      db.query(
        `select public.set_inventory_accounting_mode('${uid(9)}','product_fifo')`,
      ),
      /owner access required/,
    );
    await assert.rejects(
      db.query(`update public.inventory_cost_batches set unit_cost=1`),
      /permission denied/,
    );
    await assert.rejects(
      db.query(
        `select public.set_inventory_accounting_mode('${uid(1)}','period_total')`,
      ),
      /already started/,
    );
  } finally {
    await db.close();
  }
});
test("missing costs block settlement; extra expenses and FIFO costs are frozen and reported consistently", async () => {
  const db = await setup();
  try {
    await sell(db, 2);
    assert.equal((await preview(db)).missing_costs.length, 1);
    const entries = [
      {
        id: uid(80),
        date: "2026-11-12",
        category: "包材",
        name: "包材",
        amount: 50,
        notes: "",
      },
    ];
    await db.query(
      `select public.save_financial_period_details('${uid(1)}','2026-11-01','2026-12-31',$1,'[]','',0)`,
      [JSON.stringify(entries)],
    );
    await assert.rejects(
      db.query(
        `select public.create_financial_settlement('${uid(1)}','2026-11-01','2026-12-31')`,
      ),
      /missing product batch costs/,
    );
    await setCost(db, 0, 180);
    const settlement = await db.query<{ cost: string; profit: string }>(
      `select * from public.create_financial_settlement('${uid(1)}','2026-11-01','2026-12-31')`,
    );
    assert.equal(Number(settlement.rows[0].cost), 410);
    assert.equal(Number(settlement.rows[0].profit), 190);
    const snapshot = await preview(db);
    assert.equal(snapshot.product_cost, 360);
    assert.equal(snapshot.settled, true);
    await assert.rejects(setCost(db, 0, 999), /settled batch cost is locked/);
    await db.exec(
      `update public.products set stock=stock+10 where id='${uid(10)}'`,
    );
    await setCost(db, 1, 200);
    assert.deepEqual(await preview(db), snapshot);
    await assert.rejects(
      db.query(
        `update public.order_items set quantity=1 where id='${uid(120)}'`,
      ),
      /settled order cannot be changed/,
    );
    const report = await db.query<{
      r: { cost: { amount: number }; preview: { product_cost: number } };
    }>(
      `select public.get_financial_period_report('${uid(1)}','2026-11-01','2026-12-31') r`,
    );
    assert.equal(report.rows[0].r.cost.amount, 50);
    assert.equal(report.rows[0].r.preview.product_cost, 360);
  } finally {
    await db.close();
  }
});
test("stock adjustments do not become sold cost; zero cost is explicit and manual inventories retain old accounting", async () => {
  const db = await setup();
  try {
    await setCost(db, 0, 0);
    await db.exec(`update public.products set stock=7 where id='${uid(10)}'`);
    assert.equal((await batches(db))[0].remaining, 7);
    await sell(db, 2);
    assert.equal((await preview(db)).product_cost, 0);
    assert.equal((await preview(db)).missing_costs.length, 0);
    await db.exec("select set_config('test.role','admin',false)");
    const manual = await db.query<{
      r: { accounting_mode: string; product_cost: number };
    }>(
      `select public.get_financial_period_preview('${uid(9)}','2026-11-01','2026-12-31') r`,
    );
    assert.equal(manual.rows[0].r.accounting_mode, "period_total");
    assert.equal(manual.rows[0].r.product_cost, 0);
  } finally {
    await db.close();
  }
});

test("partial packing reserves FIFO, later receipts preserve prior allocations, revisions and RLS remain enforced", async () => {
  const db = await setup();
  try {
    await setCost(db, 0, 180);
    await sell(db, 2);
    await db.exec(
      `update public.orders set status='packing' where id='${uid(20)}'`,
    );
    assert.equal((await preview(db)).product_cost, 0);
    assert.equal((await batches(db))[0].remaining, 8);
    await db.exec(
      `update public.products set stock=stock+3 where id='${uid(10)}'`,
    );
    await setCost(db, 1, 10);
    await db.exec(
      `update public.orders set status='packed' where id='${uid(20)}'`,
    );
    assert.equal((await preview(db)).product_cost, 360);
    const first = (await batches(db))[0];
    await assert.rejects(
      db.query("select public.save_inventory_batch_cost($1,200,'',1)", [
        first.id,
      ]),
      /changed; reload/,
    );
    await assert.rejects(
      db.query("select public.save_inventory_batch_cost($1,0.001,'',$2)", [
        first.id,
        first.revision,
      ]),
      /invalid batch cost/,
    );
    await db.exec(
      `reset role;insert into public.inventory_cost_batches(owner_id,product_id,quantity,unit_cost) values('${uid(9)}','${uid(11)}',10,10);set role authenticated;`,
    );
    assert.equal(
      (
        await db.query(
          `select * from public.inventory_cost_batches where owner_id='${uid(9)}'`,
        )
      ).rows.length,
      0,
    );
    await db.exec("reset role;set role anon");
    await assert.rejects(
      db.query("select * from public.inventory_cost_batches"),
      /permission denied/,
    );
    await assert.rejects(
      db.query(`select public.get_inventory_product_costs('${uid(10)}')`),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});

test("confirmed full-name repair activates only NN inventory, creates opening costs, restores SQL Editor context and can be rerun", async () => {
  const db = await setup(true);
  const repair = await read(
    "supabase/migrations/20261112021946_correct_nn_inventory_accounting_mode.sql",
  );
  try {
    assert.equal((await batches(db)).length, 0);
    await sell(db, 2);
    await db.exec(
      "reset role;select set_config('request.jwt.claim.sub','',false)",
    );
    await db.exec(repair);
    const inventories = await db.query<{
      name: string;
      accounting_mode: string;
    }>(
      "select name,accounting_mode from public.inventory_databases order by name",
    );
    assert.deepEqual(inventories.rows, [
      { name: "NN佛系海報代購", accounting_mode: "product_fifo" },
      { name: "海報小天地", accounting_mode: "period_total" },
    ]);
    assert.equal(
      (await db.query<{ id: string | null }>("select auth.uid() id")).rows[0]
        .id,
      null,
    );
    await db.exec(
      `select set_config('request.jwt.claim.sub','${uid(2)}',false);set role authenticated`,
    );
    const opening = await batches(db);
    assert.equal(opening.length, 1);
    assert.equal(opening[0].quantity, 10);
    assert.equal(opening[0].remaining, 8);
    assert.equal(opening[0].unit_cost, null);
    assert.equal((await preview(db)).missing_costs.length, 1);
    await setCost(db, 0, 180);
    assert.equal((await preview(db)).product_cost, 360);
    await db.exec("reset role");
    await db.exec(repair);
    assert.equal((await batches(db)).length, 1);
    assert.equal((await batches(db))[0].unit_cost, 180);
    await db.exec("set role authenticated");
    await assert.rejects(db.exec(repair), /database owner/);
    await db.exec("rollback");
  } finally {
    await db.close();
  }
});

test("name repair rejects missing and ambiguous targets before changing any inventory", async () => {
  const db = await setup(true);
  const repair = await read(
    "supabase/migrations/20261112021946_correct_nn_inventory_accounting_mode.sql",
  );
  try {
    await db.exec(
      `reset role;update public.inventory_databases set name='不同名稱' where id='${uid(1)}'`,
    );
    await assert.rejects(db.exec(repair), /Expected one inventory.*found 0/);
    await db.exec("rollback");
    await db.exec(
      `update public.inventory_databases set name='NN佛系海報代購' where id='${uid(1)}';insert into public.inventory_databases(id,name,accounting_mode) values('${uid(99)}','NN佛系海報代購','period_total')`,
    );
    await assert.rejects(db.exec(repair), /Expected one inventory.*found 2/);
    await db.exec("rollback");
    assert.equal(
      (
        await db.query(
          "select * from public.inventory_databases where accounting_mode='product_fifo'",
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from public.inventory_cost_batches")).rows
        .length,
      0,
    );
  } finally {
    await db.close();
  }
});
