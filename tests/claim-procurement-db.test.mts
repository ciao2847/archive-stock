import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

type Line = {
  productId: string | null;
  sku: string;
  name: string;
  ip: string;
  craft: string;
  quantity: number;
  customerCount: number;
  amount: number;
};
type ProductTotal = Omit<Line, "amount"> & { paidQuantity: number };
type Round = {
  id: string;
  number: number;
  status: "open" | "closed";
  submissionCount: number;
  customerCount: number;
  itemCount: number;
  totalAmount: number;
  lines: Line[];
  productTotals: ProductTotal[];
};
type Procurement = {
  current: {
    id: string;
    number: number;
    submissionCount: number;
    paidSubmissionCount: number;
    unpaidSubmissionCount: number;
    itemCount: number;
    totalAmount: number;
    productTotals: ProductTotal[];
  };
  selected: Round;
  history: Array<Round>;
  historyHasMore: boolean;
};
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("procurement closes paid orders once, carries unpaid orders, preserves snapshots, scope and fulfillment", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema private;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table auth.users(id uuid primary key);`);
    const legacy = await readFile("supabase/legacy/schema.sql", "utf8");
    await db.exec(
      legacy
        .replace("create extension if not exists pgcrypto;", "")
        .split("create or replace function public.my_role()")[0],
    );
    await db.exec(`
    create table inventory_databases(id uuid primary key,name text);
    alter table profiles add inventory_owner_id uuid;
    alter table products add owner_id uuid;
    alter table customers add owner_id uuid,add nickname text,add created_by uuid;
    alter table orders add owner_id uuid,add deleted_at timestamptz,add created_by uuid;
    alter table order_items add unit_price numeric default 0,add packed_quantity integer default 0;
    create function public.my_role() returns public.user_role language sql stable security definer set search_path='' as $$select role from public.profiles where id=auth.uid()$$;
    create function private.current_inventory_owner_id() returns uuid language sql stable security definer set search_path='' as $$select inventory_owner_id from public.profiles where id=auth.uid()$$;
    create table claim_forms(id bigint generated always as identity primary key,owner_id uuid not null references inventory_databases(id),public_token uuid default gen_random_uuid() unique,title text,is_open boolean default true,closes_at timestamptz);
    create table claim_form_products(form_id bigint references claim_forms(id),product_id uuid references products(id),display_name text,unit_price numeric,max_quantity_per_customer integer default 99,is_enabled boolean default true,primary key(form_id,product_id));
    insert into auth.users values('${id(1)}'),('${id(2)}');
    insert into inventory_databases values('${id(10)}','First'),('${id(20)}','Other');
    insert into profiles(id,display_name,inventory_owner_id) values('${id(1)}','First','${id(10)}'),('${id(2)}','Other','${id(20)}');
    select set_config('request.jwt.claim.sub','${id(1)}',false);
  `);
    const claims = await readFile(
      "supabase/migrations/20260910073243_add_public_claim_forms.sql",
      "utf8",
    );
    await db.exec(
      claims.slice(
        claims.indexOf("create table public.claim_submissions"),
        claims.indexOf("alter table public.claim_forms enable"),
      ),
    );
    await db.exec(`alter table claim_submissions add payment_status text default 'pending';
    create table claim_submission_payments(id bigint generated always as identity primary key,submission_id bigint references claim_submissions(id) on delete cascade,amount numeric not null check(amount>0));
    alter table orders add claim_submission_id bigint unique references claim_submissions(id) on delete cascade,add bundle_claim_order_id bigint;
    create table packing_package_items(order_id uuid);create table settlement_orders(order_id uuid);
    create table fanmade_details(product_id uuid primary key references products(id),craft text);
    grant usage on schema public,private,auth to authenticated;
    grant select,insert,update,delete on all tables in schema public to authenticated;
    grant usage on all sequences in schema public to authenticated;
  `);
    const submitSql = await readFile(
      "supabase/migrations/20261002001346_add_inventory_line_and_claim_product_availability.sql",
      "utf8",
    );
    await db.exec(
      submitSql.slice(
        submitSql.indexOf(
          "create or replace function public.submit_public_claim(",
        ),
        submitSql.indexOf("notify pgrst"),
      ),
    );
    const projection = await readFile(
      "supabase/migrations/20261020033449_connect_claims_to_packing.sql",
      "utf8",
    );
    await db.exec(
      projection.slice(
        projection.indexOf("create function private.sync_claim_fulfillment("),
        projection.indexOf("create trigger bundle_fulfillment_confirm"),
      ),
    );
    const packing = await readFile(
      "supabase/migrations/20260910031116_customer_centered_packing.sql",
      "utf8",
    );
    await db.exec(
      packing.slice(
        packing.indexOf(
          "create or replace function public.complete_order_packing(",
        ),
        packing.indexOf("notify pgrst"),
      ),
    );
    await db.exec(`insert into works(id,title_zh) values('${id(30)}','蜘蛛人');
    insert into products(id,owner_id,name,category,work_id,stock,price,poster_crafts) values
     ('${id(100)}','${id(10)}','夜景｜亮銀龍','海報','${id(30)}',100,350,array['亮銀龍']),
     ('${id(101)}','${id(10)}','夜景｜水波紋','海報','${id(30)}',100,350,array['水波紋']);
    insert into fanmade_details values('${id(100)}','亮銀龍'),('${id(101)}','水波紋');
    insert into claim_forms(owner_id,title) values('${id(10)}','預購表單'),('${id(10)}','飯製表單'),('${id(20)}','其他庫藏');
    insert into claim_form_products(form_id,product_id,display_name,unit_price) select f.id,p.id,p.name,p.price from claim_forms f cross join products p where f.owner_id='${id(10)}';
  `);
    const forms = (
      await db.query<{ id: number; public_token: string }>(
        "select id,public_token from claim_forms order by id",
      )
    ).rows;
    const submit = async (
      n: number,
      items: Array<{ product_id: string; quantity: number }>,
      form = 0,
      phone = "0912345678",
    ) => {
      await db.query(
        "select * from submit_public_claim($1,'測試客戶',$2,'',$3,$4::jsonb)",
        [forms[form].public_token, phone, id(n), JSON.stringify(items)],
      );
      return (
        await db.query<{ id: number }>(
          "select id from claim_submissions where request_id=$1",
          [id(n)],
        )
      ).rows[0].id;
    };
    const setStatus = async (source: number, status: string) =>
      db.query("update claim_submissions set payment_status=$2 where id=$1", [
        source,
        status,
      ]);
    const item = (p = 100, q = 1) => [{ product_id: id(p), quantity: q }];
    const preexisting = await submit(1000, item());
    await setStatus(preexisting, "paid");
    await db.exec(
      await readFile(
        "supabase/migrations/20261115064319_claim_procurement_rounds.sql",
        "utf8",
      ),
    );
    await db.exec("set role authenticated");
    const get = async (
      form = 0,
      round: string | null = null,
      page = 1,
      owner = id(10),
    ) =>
      (
        await db.query<{ data: Procurement }>(
          "select get_claim_procurement($1,$2,$3,$4) data",
          [owner, forms[form].id, round, page],
        )
      ).rows[0].data;
    const close = async (
      round: string,
      request: number,
      form = 0,
      owner = id(10),
    ) =>
      (
        await db.query<{
          data: { closedRoundId: string; nextRoundId: string };
        }>("select close_claim_procurement($1,$2,$3,$4) data", [
          owner,
          forms[form].id,
          round,
          id(request),
        ])
      ).rows[0].data;
    // An already-closed batch predates the new counters. The migration must
    // derive its four counters from saved lines without rewriting any history.
    const oldFanSource = await submit(990, item(101, 3), 1);
    await setStatus(oldFanSource, "paid");
    const oldFanRound = (await get(1)).current;
    const oldFanClose = await close(oldFanRound.id, 1999, 1);
    const oldFanSnapshot = (await get(1, oldFanClose.closedRoundId)).selected;
    assert.equal(oldFanSnapshot.productTotals, undefined);
    await db.exec("reset role");
    await db.exec(
      await readFile(
        "supabase/migrations/20261117062627_claim_procurement_batch_product_totals.sql",
        "utf8",
      ),
    );
    await db.exec("set role authenticated");
    const migratedOldFan = (await get(1, oldFanClose.closedRoundId)).selected;
    assert.deepEqual(migratedOldFan.lines, oldFanSnapshot.lines);
    assert.deepEqual(
      migratedOldFan.productTotals.map((x) => [
        x.craft,
        x.customerCount,
        x.quantity,
        x.paidQuantity,
      ]),
      [["水波紋", 1, 3, 3]],
      "pre-migration paid snapshots display all four counters",
    );
    assert.deepEqual((await get(1)).selected.productTotals, []);
    assert.equal(
      (await get()).current.paidSubmissionCount,
      1,
      "existing sources enter the first open round",
    );
    const both = await submit(1001, [...item(100, 2), ...item(101, 3)]);
    await setStatus(both, "paid");
    const unpaid = await submit(1002, item());
    const half = await submit(1003, item(101, 4));
    await setStatus(half, "half_paid");
    const misleadingPaid = await submit(1004, item(100, 5));
    await setStatus(misleadingPaid, "paid");
    const eventsPaid = await submit(1005, item(), 0, "0987654321");
    await db.query(
      "insert into claim_submission_payments(submission_id,amount) values($1,100),($2,350)",
      [misleadingPaid, eventsPaid],
    );
    const cancelled = await submit(1006, item(100, 2));
    await setStatus(cancelled, "paid");
    await db.query(
      "update orders set status='cancelled' where claim_submission_id=$1",
      [cancelled],
    );
    const removed = await submit(1007, item());
    await setStatus(removed, "paid");
    await db.query(
      "update orders set deleted_at=now() where claim_submission_id=$1",
      [removed],
    );
    let state = await get();
    assert.equal(state.current.submissionCount, 6);
    assert.equal(state.current.paidSubmissionCount, 3);
    assert.equal(state.current.unpaidSubmissionCount, 3);
    assert.equal(state.current.itemCount, 7);
    assert.equal(state.current.totalAmount, 2450);
    assert.equal(state.selected.submissionCount, 3);
    assert.equal(state.selected.customerCount, 2);
    assert.deepEqual(
      state.selected.productTotals
        .map((x) => [
          x.craft,
          x.customerCount,
          x.quantity,
          x.quantity - x.paidQuantity,
          x.paidQuantity,
        ])
        .sort(),
      [
        ["亮銀龍", 2, 10, 6, 4],
        ["水波紋", 1, 7, 4, 3],
      ],
      "four counters include unpaid/partial sources, prefer actual payment events, and exclude cancelled/deleted orders",
    );
    assert.deepEqual(state.current.productTotals, state.selected.productTotals);
    assert.deepEqual(
      state.selected.lines.map((x) => [x.craft, x.quantity]).sort(),
      [
        ["亮銀龍", 4],
        ["水波紋", 3],
      ],
    );
    await assert.rejects(get(2, null, 1, id(20)), /owner access required/);
    const firstId = state.current.id,
      firstClosed = await close(firstId, 2000);
    assert.deepEqual(
      await close(firstId, 2000),
      firstClosed,
      "lost-response close retry returns the same document and next round",
    );
    await assert.rejects(close(firstId, 2001), /已結單|已更新/);
    await assert.rejects(close(firstClosed.nextRoundId, 2000), /同一結單/);
    const frozen = (await get(0, firstId)).selected;
    state = await get();
    assert.equal(state.current.id, firstClosed.nextRoundId);
    assert.equal(state.current.number, 2);
    assert.equal(state.current.itemCount, 0);
    assert.equal(state.current.unpaidSubmissionCount, 3);
    assert.deepEqual(
      state.selected.productTotals
        .map((x) => [x.craft, x.quantity, x.paidQuantity])
        .sort(),
      [
        ["亮銀龍", 6, 0],
        ["水波紋", 4, 0],
      ],
      "next batch starts with only carried unpaid quantities, with no paid quantities duplicated",
    );
    assert.deepEqual(
      frozen.productTotals
        .map((x) => [x.craft, x.quantity, x.paidQuantity])
        .sort(),
      [
        ["亮銀龍", 4, 4],
        ["水波紋", 3, 3],
      ],
      "closed counters represent the immutable paid procurement snapshot",
    );
    assert.deepEqual(
      (await get(0, firstId)).current.productTotals,
      state.current.productTotals,
      "viewing history does not change the current batch counters",
    );
    await assert.rejects(close(state.current.id, 2002), /沒有已付款/);
    assert.equal(
      (
        await db.query<{ stock: number }>(
          "select stock from products where id=$1",
          [id(100)],
        )
      ).rows[0].stock,
      100,
      "procurement does not touch physical stock",
    );
    // Delete a closed source, change labels/payment; the historical snapshot stays fixed.
    await db.query("delete from claim_submissions where id=$1", [preexisting]);
    await setStatus(both, "pending");
    await db.query(
      "update products set name='已更名',poster_crafts=array['新工藝'] where id=$1",
      [id(100)],
    );
    await db.query(
      "update fanmade_details set craft='新工藝' where product_id=$1",
      [id(100)],
    );
    assert.deepEqual((await get(0, firstId)).selected, frozen);
    await assert.rejects(
      db.query(
        "update claim_procurement_lines set quantity=999 where round_id=$1",
        [firstId],
      ),
      /permission denied/,
    );
    await assert.rejects(
      db.query(
        "update claim_procurement_rounds set total_amount=0 where id=$1",
        [firstId],
      ),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select * from private.claim_procurement_memberships"),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select private.claim_procurement_payload($1)", [firstId]),
      /permission denied/,
      "replaced payload helper remains inaccessible to authenticated callers",
    );
    await assert.rejects(
      db.query("delete from claim_forms where id=$1", [forms[0].id]),
      /已有結單紀錄/,
    );
    // Carrying an unpaid source preserves its order; after full payment it closes once next time.
    const orderBefore = (
      await db.query<{ id: string }>(
        "select id from orders where claim_submission_id=$1",
        [unpaid],
      )
    ).rows[0].id;
    await setStatus(unpaid, "paid");
    assert.equal((await get()).current.paidSubmissionCount, 1);
    assert.deepEqual(
      (await get()).selected.productTotals
        .map((x) => [x.quantity, x.paidQuantity])
        .sort((a, b) => a[0] - b[0]),
      [
        [4, 0],
        [6, 1],
      ],
      "late payment moves carried quantity into the paid counter only in its current batch",
    );
    const second = await close(firstClosed.nextRoundId, 2003);
    assert.equal(
      (await get()).selected.productTotals.reduce(
        (sum, x) => sum + x.quantity,
        0,
      ),
      9,
      "second close carries only remaining unpaid quantities",
    );
    assert.equal(
      (
        await db.query<{ id: string }>(
          "select id from orders where claim_submission_id=$1",
          [unpaid],
        )
      ).rows[0].id,
      orderBefore,
    );
    await db.query(
      "update order_items set scanned_quantity=quantity where order_id=$1",
      [orderBefore],
    );
    await db.query("select complete_order_packing($1)", [orderBefore]);
    assert.equal(
      (
        await db.query<{ stock: number }>(
          "select stock from products where id=$1",
          [id(100)],
        )
      ).rows[0].stock,
      99,
    );
    assert.equal(
      (await get()).current.itemCount,
      0,
      "already-closed paid sources never enter the next tally",
    );
    assert.equal((await get(0, second.closedRoundId)).selected.itemCount, 1);
    // Fanmade and preorder forms maintain separate rounds and sharing URLs stay open.
    const fanSource = await submit(1010, item(101, 2), 1);
    await setStatus(fanSource, "paid");
    const fanRound = (await get(1)).current;
    assert.equal(fanRound.number, 2);
    assert.equal(fanRound.itemCount, 2);
    const fanClose = await close(fanRound.id, 2010, 1);
    assert.equal((await get(1)).current.number, 3);
    assert.equal((await get()).current.number, 3);
    await db.query(
      "update orders set status='cancelled',deleted_at=now() where claim_submission_id=$1",
      [oldFanSource],
    );
    await db.query(
      "update products set name='舊歷史商品已更名',poster_crafts=array['舊歷史商品新工藝'] where id=$1",
      [id(101)],
    );
    await db.query(
      "update fanmade_details set craft='舊歷史商品新工藝' where product_id=$1",
      [id(101)],
    );
    assert.deepEqual(
      (await get(1, oldFanClose.closedRoundId)).selected,
      migratedOldFan,
      "pre-migration counters stay frozen after source cancellation and later product/craft edits",
    );
    assert.equal(
      (
        await db.query<{ is_open: boolean }>(
          "select is_open from claim_forms where id=$1",
          [forms[1].id],
        )
      ).rows[0].is_open,
      true,
    );
    await assert.rejects(get(0, fanClose.closedRoundId), /round not found/);
    // History is paginated, while every round remains individually readable.
    for (let n = 0; n < 11; n++) {
      const source = await submit(1100 + n, item());
      await setStatus(source, "paid");
      const active = (await get()).current;
      await close(active.id, 2100 + n);
    }
    const history = await get();
    assert.equal(history.history.length, 12);
    assert.equal(history.historyHasMore, true);
    const history2 = await get(0, null, 2);
    assert.equal(history2.history.length, 1);
    assert.equal(history2.historyHasMore, false);
    assert.equal(history2.history[0].id, firstId);
    await db.exec(
      `select set_config('request.jwt.claim.sub','${id(2)}',false)`,
    );
    assert.equal(
      (
        await db.query(
          "select * from claim_procurement_rounds where owner_id=$1",
          [id(10)],
        )
      ).rows.length,
      0,
    );
    await assert.rejects(get(), /owner access required/);
    await db.exec("set role anon");
    await assert.rejects(
      db.query("select get_claim_procurement($1,$2)", [id(10), forms[0].id]),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select close_claim_procurement($1,$2,$3,$4)", [
        id(10),
        forms[0].id,
        firstId,
        id(9999),
      ]),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
