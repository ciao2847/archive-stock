import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import type { AccountingReport } from "../src/lib/accounting-details.ts";
import { PGlite } from "@electric-sql/pglite";
const uid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
test("period detail RPC enforces tenant access, audit revisions, direct-write validation and settlement locking", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
 create role authenticated;create role anon;create schema private;create schema auth;create schema storage;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function public.my_role() returns text language sql as $$select coalesce(nullif(current_setting('test.role',true),''),'staff')$$;
 create function private.current_inventory_owner_id() returns uuid language sql as $$select '${uid(1)}'::uuid$$;
 grant usage on schema private,auth to authenticated;
 create table public.inventory_databases(id uuid primary key);
 create table public.profiles(id uuid primary key);
 create table public.products(id uuid primary key,sku text,name text);
 create table public.customers(id uuid primary key,name text,nickname text);
 create table public.orders(id uuid primary key,owner_id uuid,customer_id uuid,order_no text,status text,deleted_at timestamptz,packed_at timestamptz,created_at timestamptz,discount numeric default 0,shipping_income numeric default 0);
 create table public.order_items(id uuid primary key,order_id uuid,product_id uuid,quantity integer,unit_price numeric);
 create table public.settlements(id uuid primary key default gen_random_uuid(),settlement_no text default 'S-TEST',owner_id uuid,period_start date,period_end date,revenue numeric,cost numeric,profit numeric generated always as(revenue-cost) stored,created_by uuid,cost_source text default 'legacy_product');
 create table public.settlement_orders(settlement_id uuid,order_id uuid,revenue numeric);
 create table public.settlement_products(id uuid);
 create table storage.objects(bucket_id text,name text);
 insert into public.inventory_databases values('${uid(1)}'),('${uid(9)}');
 insert into public.profiles values('${uid(2)}');
 grant select on public.inventory_databases,public.profiles,public.products,public.customers,public.orders,public.order_items,public.settlements,public.settlement_orders to authenticated;
 select set_config('request.jwt.claim.sub','${uid(2)}',false);
 `);
    const base = await readFile(
      "supabase/migrations/20261008004748_calculator_period_accounting.sql",
      "utf8",
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
      await readFile(
        "supabase/migrations/20261008014308_poster_revenue_settlement.sql",
        "utf8",
      ),
    );
    await db.exec(
      base.slice(
        base.indexOf("revoke insert, update on public.settlements"),
        base.indexOf("-- Disable legacy product-cost writes"),
      ),
    );
    await db.exec(
      await readFile(
        "supabase/migrations/20261021083916_itemized_costs_and_profit_sharing.sql",
        "utf8",
      ),
    );
    const entries = [
      {
        id: uid(3),
        date: "2026-09-10",
        category: "國際運費",
        name: "韓國國際運費",
        amount: 100.01,
        notes: "",
      },
    ];
    const shares = [
      { id: uid(4), name: "甲", basisPoints: 6000 },
      { id: uid(5), name: "乙", basisPoints: 4000 },
    ];
    const save = (
      revision = 0,
      owner = uid(1),
      costs: unknown = entries,
      split: unknown = shares,
    ) =>
      db.query<{ cost_entries: unknown; amount: string; revision: number }>(
        `select * from public.save_financial_period_details($1,'2026-09-01','2026-10-31',$2::jsonb,$3::jsonb,'',$4)`,
        [owner, JSON.stringify(costs), JSON.stringify(split), revision],
      );
    await db.exec("set role authenticated");
    const saved = await save();
    assert.equal(Number(saved.rows[0].amount), 100.01);
    assert.equal(saved.rows[0].revision, 1);
    await assert.rejects(save(), /period cost was changed/);
    await assert.rejects(save(0, uid(9)), /owner access required/);
    await assert.rejects(
      save(1, uid(1), entries, [{ ...shares[0], basisPoints: 5000 }]),
      /100 percent/,
    );
    await assert.rejects(
      save(1, uid(1), [{ ...entries[0], date: "2026-11-01" }]),
      /invalid financial details/,
    );
    await assert.rejects(
      save(1, uid(1), [{ ...entries[0], name: null }]),
      /invalid financial details/,
    );
    await assert.rejects(
      db.query(
        `update public.financial_period_costs set amount=1 where owner_id=$1`,
        [uid(1)],
      ),
      /cost detail total mismatch/,
    );
    await save(1, uid(1), [{ ...entries[0], amount: 200 }]);
    const audit = await db.query<{ cost_entries: unknown }>(
      "select cost_entries from public.financial_period_cost_revisions order by revision",
    );
    assert.equal(audit.rows.length, 2);
    assert.deepEqual(audit.rows[0].cost_entries, entries);
    await db.exec("reset role");
    await db.query(`insert into public.products values($1,'A001','海報')`, [
      uid(6),
    ]);
    await db.query(
      `insert into public.orders(id,owner_id,order_no,status,packed_at,created_at,discount,shipping_income) values($1,$2,'O-1','packed','2026-09-30T16:00:00Z','2026-09-01',10,50)`,
      [uid(7), uid(1)],
    );
    await db.query(`insert into public.order_items values($1,$2,$3,2,500)`, [
      uid(8),
      uid(7),
      uid(6),
    ]);
    await db.exec("set role authenticated");
    const before = await db.query<{ report: AccountingReport }>(
      `select public.get_financial_period_report($1,'2026-09-01','2026-10-31') as report`,
      [uid(1)],
    );
    assert.equal(Number(before.rows[0].report.preview.revenue), 990);
    assert.equal(before.rows[0].report.orders[0].items[0].sku, "A001");
    await db.query(
      `select public.create_financial_settlement($1,'2026-09-01','2026-10-31')`,
      [uid(1)],
    );
    await assert.rejects(save(2), /period already settled/);
    const after = await db.query<{ report: AccountingReport }>(
      `select public.get_financial_period_report($1,'2026-09-01','2026-10-31') as report`,
      [uid(1)],
    );
    assert.equal(after.rows[0].report.preview.settled, true);
    assert.equal(after.rows[0].report.orders.length, 1);
    assert.deepEqual(after.rows[0].report.cost!.share_rules, shares);
    const periods = await db.query<{
      periods: Array<{ start: string; end: string }>;
    }>(`select public.get_financial_report_periods($1) as periods`, [uid(1)]);
    assert.equal(periods.rows[0].periods.length, 1);
    await assert.rejects(
      db.query(`select public.get_financial_report_periods($1)`, [uid(9)]),
      /owner access required/,
    );
    await assert.rejects(
      db.query(
        `select public.get_financial_period_report($1,'2026-09-01','2026-10-31')`,
        [uid(9)],
      ),
      /owner access required/,
    );
    await db.exec(
      `reset role;select set_config('request.jwt.claim.sub','',false);set role anon`,
    );
    await assert.rejects(save(), /permission denied/);
  } finally {
    await db.close();
  }
});
