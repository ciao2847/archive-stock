import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("custom public names survive saves and inventory renames while inherited names stay in sync", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create schema private;
      create role anon;
      create table public.products(id integer primary key, name text, country text, work_id integer, preorder_item_name text);
      create table public.claim_form_products(form_id integer, product_id integer, display_name text);
    `);
    const original = await readFile(
      "supabase/migrations/20261019003454_add_preorder_product_naming.sql",
      "utf8",
    );
    await db.exec(
      original.slice(
        original.indexOf(
          "create function private.sync_preorder_listing_names()",
        ),
        original.indexOf("notify pgrst"),
      ),
    );
    await db.exec(
      await readFile(
        "supabase/migrations/20261021001000_allow_custom_preorder_listing_names.sql",
        "utf8",
      ),
    );
    await db.exec(`
      insert into public.products values (1,'原庫存名稱','韓國',1,'A款');
      insert into public.claim_form_products values (1,1,'自訂公開名稱'), (2,1,'原庫存名稱');
      update public.claim_form_products set display_name='修改後的公開名稱' where form_id=1;
      update public.products set name='新庫存名稱' where id=1;
    `);
    const { rows } = await db.query<{ display_name: string }>(
      "select display_name from public.claim_form_products order by form_id",
    );
    assert.deepEqual(
      rows.map((row) => row.display_name),
      ["修改後的公開名稱", "新庫存名稱"],
    );
  } finally {
    await db.close();
  }
});
