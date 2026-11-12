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

async function setupDirectCosts() {
  const db = await setup();
  await db.exec(`reset role;
create role service_role;
create type public.user_role as enum('admin','staff');
create type public.product_status as enum('in_stock','reserved','packing','packed','shipped');
create table public.works(id uuid primary key default gen_random_uuid(),title_zh text,created_at timestamptz default now());
create table public.locations(id uuid primary key default gen_random_uuid(),owner_id uuid,code text,cabinet text,shelf int,bin int);
create table public.product_qr_labels(id uuid primary key default gen_random_uuid(),product_id uuid,batch_code text,status text default 'active',created_at timestamptz default now());
alter table public.products alter id set default gen_random_uuid(),alter sku set default ('A'||left(gen_random_uuid()::text,8)),
add category text,add work_id uuid,add country text,add source text,add location_id uuid,add status public.product_status default 'in_stock',
add price numeric default 0,add cost numeric default 0,add image_paths text[],add poster_format text,add poster_size text,add poster_crafts text[],add identifying_features text,add description text,add created_by uuid,add updated_at timestamptz default now();
`);
  const hardened = await read(
    "supabase/migrations/20260903001511_harden_rls_and_rpc_privileges.sql",
  );
  const a = hardened.indexOf(
    "create or replace function public.adjust_product_stock(",
  );
  const b = hardened.indexOf("\n$$;", a) + 4;
  await db.exec(hardened.slice(a, b));
  await db.exec(
    await read(
      "supabase/migrations/20261008020858_simplify_product_intake.sql",
    ),
  );
  const description = await read(
    "supabase/migrations/20260907064534_add_product_description.sql",
  );
  const update = description.indexOf(
    "create or replace function public.update_inventory_product(",
  );
  await db.exec(
    description.slice(
      update,
      description.indexOf("-- Keep the existing token-gated", update),
    ),
  );
  const naming = await read(
    "supabase/migrations/20261019003454_add_preorder_product_naming.sql",
  );
  await db.exec(
    naming.slice(
      naming.indexOf("alter table public.products"),
      naming.indexOf("create function private.enforce_preorder_product_name()"),
    ),
  );
  await db.exec(
    await read(
      "supabase/migrations/20261112024350_product_unit_cost_entry.sql",
    ),
  );
  await db.exec("set role authenticated");
  return db;
}
const productInput = (patch: Record<string, unknown> = {}) => ({
  name: "海報",
  category: "海報",
  country: "韓國",
  source: "",
  location: "",
  stock: 10,
  price: 300,
  format: "",
  size: "A3",
  crafts: [],
  feature: "",
  description: "",
  imagePaths: ["poster.webp"],
  unitCost: 180,
  ...patch,
});
async function saveDirect(
  db: PGlite,
  input: Record<string, unknown>,
  productId: string | null = null,
  owner = uid(1),
) {
  return (
    await db.query<{ id: string }>(
      "select public.save_inventory_product_with_cost($1::jsonb,$2,$3) id",
      [JSON.stringify(input), owner, productId],
    )
  ).rows[0].id;
}
test("direct poster costs create products atomically, retain zero-stock preorder costs, and use new prices only for new receipts", async () => {
  const db = await setupDirectCosts();
  try {
    const created = await saveDirect(db, productInput());
    const readProduct = () =>
      db.query<{
        r: {
          mode: string;
          unitCost: number;
          batches: Array<{ quantity: number; unit_cost: number }>;
        };
      }>("select public.get_inventory_product_costs($1) r", [created]);
    assert.equal((await readProduct()).rows[0].r.unitCost, 180);
    assert.equal((await readProduct()).rows[0].r.batches[0].unit_cost, 180);
    await saveDirect(db, productInput({ stock: 15, unitCost: 200 }), created);
    assert.deepEqual(
      (await readProduct()).rows[0].r.batches.map((b) => [
        b.quantity,
        b.unit_cost,
      ]),
      [
        [10, 180],
        [5, 200],
      ],
    );
    const preorder = await saveDirect(
      db,
      productInput({
        stock: 0,
        unitCost: 0,
        work: "作品",
        preorderItemName: "A款",
        imagePaths: [],
      }),
    );
    assert.equal(
      (
        await db.query<{ purchase_unit_cost: string }>(
          "select purchase_unit_cost from public.products where id=$1",
          [preorder],
        )
      ).rows[0].purchase_unit_cost,
      "0.00",
    );
    await db.query("update public.products set stock=3 where id=$1", [
      preorder,
    ]);
    const receipt = await db.query<{ unit_cost: string }>(
      "select unit_cost from public.inventory_cost_batches where product_id=$1",
      [preorder],
    );
    assert.equal(Number(receipt.rows[0].unit_cost), 0);
    await assert.rejects(
      saveDirect(db, productInput(), null, uid(9)),
      /owner access required/,
    );
    await assert.rejects(
      saveDirect(db, productInput({ unitCost: 0.001 })),
      /invalid product unit cost/,
    );
  } finally {
    await db.close();
  }
});
test("direct existing-batch edits reject stale revisions and settled costs without partially changing product data", async () => {
  const db = await setupDirectCosts();
  try {
    const opening = (await batches(db))[0];
    await saveDirect(
      db,
      productInput({
        unitCost: 180,
        costBatchId: opening.id,
        expectedCostRevision: 1,
      }),
      uid(10),
    );
    assert.equal((await batches(db))[0].unit_cost, 180);
    await assert.rejects(
      saveDirect(
        db,
        productInput({
          name: "不可儲存",
          price: 999,
          unitCost: 190,
          costBatchId: opening.id,
          expectedCostRevision: 1,
        }),
        uid(10),
      ),
      /changed; reload/,
    );
    assert.equal(
      (
        await db.query<{ name: string }>(
          "select name from public.products where id=$1",
          [uid(10)],
        )
      ).rows[0].name,
      "海報",
    );
    await sell(db, 2);
    await db.exec(
      `select public.save_financial_period_details('${uid(1)}','2026-11-01','2026-12-31','[]','[]','',0);select public.create_financial_settlement('${uid(1)}','2026-11-01','2026-12-31')`,
    );
    await assert.rejects(
      saveDirect(
        db,
        productInput({
          stock: 8,
          price: 999,
          unitCost: 200,
          costBatchId: opening.id,
          expectedCostRevision: 2,
        }),
        uid(10),
      ),
      /settled batch cost is locked/,
    );
    const persisted = await db.query<{
      price: string;
      purchase_unit_cost: string;
    }>("select price,purchase_unit_cost from public.products where id=$1", [
      uid(10),
    ]);
    assert.equal(Number(persisted.rows[0].price), 300);
    assert.equal(Number(persisted.rows[0].purchase_unit_cost), 180);
    await saveDirect(db, productInput({ stock: 8, unitCost: 210 }), uid(10));
    assert.equal((await preview(db)).product_cost, 360);
  } finally {
    await db.close();
  }
});

async function setupBatchTotals() {
  const db = await setupDirectCosts();
  await db.exec("reset role");
  await db.exec(
    await read(
      "supabase/migrations/20261112032729_batch_total_costs_and_product_batches.sql",
    ),
  );
  await db.exec("set role authenticated");
  return db;
}
const batchRow = (
  quantity: number,
  totalCost: number | null,
  patch: Record<string, unknown> = {},
) => ({ quantity, totalCost, date: "2026-11-01", notes: "", ...patch });
async function saveRows(
  db: PGlite,
  rows: unknown[],
  stock: number,
  id: string | null = null,
  owner = uid(1),
) {
  return (
    await db.query<{ id: string }>(
      "select public.save_inventory_product_batches($1,$2,$3) id",
      [
        JSON.stringify(
          productInput({ stock, unitCost: undefined, costBatches: rows }),
        ),
        owner,
        id,
      ],
    )
  ).rows[0].id;
}
async function productBatches(db: PGlite, id: string) {
  return (
    await db.query<{
      r: {
        batches: Array<{
          id: string;
          quantity: number;
          remaining: number;
          total_cost: number | null;
          received_at: string;
          unit_cost: number | null;
          revision: number;
        }>;
      };
    }>("select public.get_inventory_product_costs($1) r", [id])
  ).rows[0].r.batches;
}
test("batch totals create multiple receipts once and split opening stock without changing physical quantity", async () => {
  const db = await setupBatchTotals();
  try {
    const id = await saveRows(db, [batchRow(10, 1800), batchRow(5, 1000)], 15);
    const created = await productBatches(db, id);
    assert.deepEqual(
      created.map((b) => [b.quantity, b.total_cost, b.unit_cost]),
      [
        [10, 1800, 180],
        [5, 1000, 200],
      ],
    );
    assert.equal(
      (
        await db.query<{ stock: number }>(
          "select stock from public.products where id=$1",
          [id],
        )
      ).rows[0].stock,
      15,
    );
    const opening = (await productBatches(db, uid(10)))[0];
    await sell(db, 2);
    await saveRows(
      db,
      [
        batchRow(4, 400, { sourceBatchId: opening.id, expectedRevision: 1 }),
        batchRow(6, 1200, { sourceBatchId: opening.id, expectedRevision: 1 }),
      ],
      8,
      uid(10),
    );
    const split = await productBatches(db, uid(10));
    assert.equal(split.length, 2);
    assert.equal(
      split.reduce((n, b) => n + b.remaining, 0),
      8,
    );
    assert.equal((await preview(db)).product_cost, 200);
    const snapshots = split.map((b) =>
      batchRow(b.quantity, b.total_cost, {
        id: b.id,
        expectedRevision: b.revision,
      }),
    );
    await saveRows(db, [...snapshots, batchRow(3, 300)], 11, uid(10));
    assert.equal((await productBatches(db, uid(10))).length, 3);
    await assert.rejects(
      saveRows(db, [...snapshots, batchRow(1, 100)], 9, uid(10)),
      /cost batch list changed|inventory changed/,
    );
  } finally {
    await db.close();
  }
});
test("splitting equal-date receipts preserves FIFO order through repeated splits", async () => {
  const db = await setupBatchTotals();
  try {
    const id = await saveRows(db, [batchRow(4, 40), batchRow(2, 200)], 6);
    let receipts = await productBatches(db, id);
    const saved = (b: (typeof receipts)[number]) =>
      batchRow(b.quantity, b.total_cost, {
        id: b.id,
        expectedRevision: b.revision,
      });
    await saveRows(
      db,
      [
        batchRow(1, 10, { sourceBatchId: receipts[0].id, expectedRevision: 1 }),
        batchRow(3, 30, { sourceBatchId: receipts[0].id, expectedRevision: 1 }),
        saved(receipts[1]),
      ],
      6,
      id,
    );
    receipts = await productBatches(db, id);
    assert.deepEqual(
      receipts.map((b) => b.quantity),
      [1, 3, 2],
    );
    await saveRows(
      db,
      [
        saved(receipts[0]),
        batchRow(1, 10, { sourceBatchId: receipts[1].id, expectedRevision: 1 }),
        batchRow(2, 20, { sourceBatchId: receipts[1].id, expectedRevision: 1 }),
        saved(receipts[2]),
      ],
      6,
      id,
    );
    assert.deepEqual(
      (await productBatches(db, id)).map((b) => b.quantity),
      [1, 1, 2, 2],
    );
    await db.exec(
      `begin;insert into public.orders(id,owner_id,order_no,status,packed_at) values('${uid(45)}','${uid(1)}','FIFO-SPLIT','packed','2026-11-12');insert into public.order_items values('${uid(145)}','${uid(45)}','${id}',5,5,100);update public.products set stock=1 where id='${id}';commit;`,
    );
    assert.equal((await preview(db)).product_cost, 140);
    assert.deepEqual(
      (await productBatches(db, id)).map((b) => b.remaining),
      [0, 0, 0, 1],
    );
  } finally {
    await db.close();
  }
});

test("non-divisible batch totals reconcile exactly across separate sales, partial returns and inventory adjustments", async () => {
  const db = await setupBatchTotals();
  try {
    const opening = (await productBatches(db, uid(10)))[0];
    await db.query("select public.save_inventory_batch_total($1,100,'',1)", [
      opening.id,
    ]);
    // Existing opening quantity is ten; use a new three-unit product for the fraction case.
    const id = await saveRows(db, [batchRow(3, 100)], 3);
    async function sale(n: number) {
      await db.exec(
        `begin;insert into public.orders(id,owner_id,order_no,status,packed_at) values('${uid(n)}','${uid(1)}','F-${n}','packed','2026-11-12');insert into public.order_items values('${uid(n + 100)}','${uid(n)}','${id}',1,1,100);update public.products set stock=stock-1 where id='${id}';commit;`,
      );
    }
    await sale(31);
    await sale(32);
    await sale(33);
    const amounts = await db.query<{ cost_amount: string }>(
      "select a.cost_amount from public.inventory_cost_allocations a join public.inventory_cost_batches b on b.id=a.batch_id where b.product_id=$1 order by a.order_item_id",
      [id],
    );
    assert.equal(
      amounts.rows.reduce(
        (n, r) => n + Math.round(Number(r.cost_amount) * 100),
        0,
      ),
      10000,
    );
    await db.exec(
      `begin;update public.products set stock=stock+1 where id='${id}';update public.order_items set packed_quantity=0 where order_id='${uid(32)}';update public.orders set status='cancelled' where id='${uid(32)}';commit;`,
    );
    await sale(34);
    const total = await db.query<{ cost: string }>(
      "select sum(a.cost_amount) cost from public.inventory_cost_allocations a join public.inventory_cost_batches b on b.id=a.batch_id where b.product_id=$1",
      [id],
    );
    assert.equal(Number(total.rows[0].cost), 100);
    const adjusted = await saveRows(db, [batchRow(3, 100)], 3);
    await db.query("update public.products set stock=0 where id=$1", [
      adjusted,
    ]);
    const off = await db.query<{ written_off_cost: string }>(
      "select written_off_cost from public.inventory_cost_batches where product_id=$1",
      [adjusted],
    );
    assert.equal(Number(off.rows[0].written_off_cost), 100);
    await db.exec(
      `select public.save_financial_period_details('${uid(1)}','2026-11-01','2026-12-31','[]','[]','',0);select public.create_financial_settlement('${uid(1)}','2026-11-01','2026-12-31')`,
    );
    assert.equal((await preview(db)).product_cost, 100);
  } finally {
    await db.close();
  }
});

test("multi-batch save preserves closed snapshots, rejects changed inventory and rolls back all rows on a locked-cost edit", async () => {
  const db = await setupBatchTotals();
  try {
    const opening = (await productBatches(db, uid(10)))[0];
    await db.query("select public.save_inventory_batch_total($1,1000,'',1)", [
      opening.id,
    ]);
    await sell(db, 2);
    await db.exec(
      `select public.save_financial_period_details('${uid(1)}','2026-11-01','2026-12-31','[]','[]','',0);select public.create_financial_settlement('${uid(1)}','2026-11-01','2026-12-31')`,
    );
    const frozen = await preview(db);
    const rows = [
      batchRow(1, 100),
      batchRow(10, 1100, {
        id: opening.id,
        expectedRevision: 2,
        date: new Date().toLocaleDateString("sv-SE", {
          timeZone: "Asia/Taipei",
        }),
      }),
    ];
    await assert.rejects(
      saveRows(db, rows, 9, uid(10)),
      /settled batch cost is locked/,
    );
    assert.equal((await productBatches(db, uid(10))).length, 1);
    assert.equal(
      (
        await db.query<{ stock: number }>(
          "select stock from public.products where id=$1",
          [uid(10)],
        )
      ).rows[0].stock,
      8,
    );
    await assert.rejects(
      saveRows(
        db,
        [
          batchRow(4, 400, { sourceBatchId: opening.id, expectedRevision: 2 }),
          batchRow(6, 600, { sourceBatchId: opening.id, expectedRevision: 2 }),
        ],
        8,
        uid(10),
      ),
      /settled batch cost is locked/,
    );
    assert.deepEqual(await preview(db), frozen);
    await assert.rejects(
      saveRows(db, [], 0, null, uid(9)),
      /owner access required/,
    );
    const named = (
      await db.query<{ id: string }>(
        "select public.save_inventory_product_batches($1,$2,null) id",
        [
          JSON.stringify(
            productInput({
              stock: 2,
              unitCost: undefined,
              work: "作品",
              preorderItemName: "A款",
              costBatches: [batchRow(2, 75)],
            }),
          ),
          uid(1),
        ],
      )
    ).rows[0].id;
    assert.equal((await productBatches(db, named))[0].total_cost, 75);
  } finally {
    await db.close();
  }
});
