import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { buildPaidProcurementCsv } from "../src/lib/claim-procurement.ts";

test("procurement CSV exports only paid quantities and escapes spreadsheet content", () => {
  const csv = buildPaidProcurementCsv([
    {
      sku: "A000001",
      name: 'Poster, "A"',
      quantity: 30,
      paidQuantity: 22,
      customerCount: 10,
    },
    {
      sku: "A000002",
      name: "Unpaid",
      quantity: 5,
      paidQuantity: 0,
      customerCount: 1,
    },
    {
      sku: "A000003",
      name: "=SUM(A1)",
      quantity: 2,
      paidQuantity: 1,
      customerCount: 1,
    },
  ]);
  assert.equal(
    csv,
    '\uFEFF"商品 ID","商品名稱","已付款數量"\r\n"A000001","Poster, ""A""","22"\r\n"A000003","\'=SUM(A1)","1"',
  );
  assert.equal(
    buildPaidProcurementCsv([]),
    '\uFEFF"商品 ID","商品名稱","已付款數量"',
  );
});

test("complete procurement aggregate counts only fully paid units and follows payment corrections", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
 create role authenticated;create role anon;create schema auth;create schema private;
 create type public.user_role as enum ('admin','staff');
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create function public.my_role() returns public.user_role language sql as $$select 'staff'::public.user_role$$;
 create function private.current_inventory_owner_id() returns uuid language sql as $$select '00000000-0000-4000-8000-000000000001'::uuid$$;
 create table public.claim_forms(id bigint primary key,owner_id uuid);
 create table public.products(id uuid primary key,sku text);
 create table public.claim_submissions(id bigint primary key,form_id bigint,phone_normalized text,payment_status text,nickname text default 'Customer');
 create table public.claim_submission_items(submission_id bigint,product_id uuid,product_sku text,product_name text,quantity int,unit_price numeric);
 create table public.claim_form_products(form_id bigint,product_id uuid,display_name text);
 insert into public.claim_forms values(1,'00000000-0000-4000-8000-000000000001'),(2,'00000000-0000-4000-8000-000000000002');
 insert into public.claim_submissions(id,form_id,phone_normalized,payment_status) values(1,1,'0911111111','paid'),(2,1,'0922222222','half_paid'),(3,1,'0922222222','pending'),(4,2,'0933333333','paid');
 insert into public.claim_submission_items values(1,null,'A000001','Poster',22,100),(2,null,'A000001','Poster',3,100),(3,null,'A000001','Poster',5,100),(4,null,'A000001','Poster',99,100);
 insert into public.claim_submissions(id,form_id,phone_normalized,payment_status) select n,1,'0911111111','paid' from generate_series(10,69) n;
 insert into public.claim_submission_items select n,null,'A000002','Many pages',1,100 from generate_series(10,69) n;
 grant usage on schema auth,private to authenticated;
 grant select on all tables in schema public to authenticated;
 select set_config('test.uid','00000000-0000-4000-8000-000000000001',false);
 `);
    await db.exec(
      await readFile(
        "supabase/migrations/20261105084433_paid_claim_procurement.sql",
        "utf8",
      ),
    );
    const totals = async () =>
      (
        await db.query<{
          r: {
            product_totals: Array<{
              sku: string;
              quantity: number;
              paid_quantity: number;
              customer_count: number;
            }>;
          };
        }>("select public.get_claim_form_summary(1::bigint) r")
      ).rows[0].r.product_totals;
    await db.exec("set role authenticated");
    let rows = await totals();
    let product = rows.find((p) => p.sku === "A000001")!;
    assert.equal(product.quantity, 30);
    assert.equal(product.paid_quantity, 22);
    assert.equal(product.customer_count, 2);
    assert.equal(rows.find((p) => p.sku === "A000002")!.paid_quantity, 60);
    await assert.rejects(
      db.query("select public.get_claim_form_summary(2::bigint)"),
      /owner access required/,
    );
    await db.exec(
      "reset role;update public.claim_submissions set payment_status='paid' where id=3;set role authenticated;",
    );
    rows = await totals();
    assert.equal(rows.find((p) => p.sku === "A000001")!.paid_quantity, 27);
    await db.exec(
      "reset role;update public.claim_submissions set payment_status='pending' where id=1;set role authenticated;",
    );
    rows = await totals();
    assert.equal(rows.find((p) => p.sku === "A000001")!.paid_quantity, 5);
    await db.exec("select set_config('test.uid','',false)");
    await assert.rejects(totals(), /authentication required/);
    await db.exec("reset role;set role anon");
    await assert.rejects(totals(), /permission denied/);
  } finally {
    await db.close();
  }
});
