import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const uid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
test("customer name corrections are scoped, atomic and preserve shared customer records", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
 create role anon;create role authenticated;create schema private;create schema auth;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create function public.my_role() returns text language sql as $$select 'staff'$$;
 create function private.current_inventory_owner_id() returns uuid language sql as $$select '${uid(1)}'::uuid$$;
 create table public.customers(id uuid primary key default gen_random_uuid(),owner_id uuid,name text,nickname text,contact text,created_by uuid);
 create table public.orders(id uuid primary key,owner_id uuid,customer_id uuid,status text,deleted_at timestamptz,updated_at timestamptz,claim_submission_id bigint,bundle_claim_order_id bigint);
 create table public.claim_forms(id bigint primary key,owner_id uuid);
 create table public.claim_submissions(id bigint primary key,form_id bigint,nickname text,payment_status text);
 create table public.bundle_claim_orders(id bigint primary key,owner_id uuid,customer_nickname text,status text,updated_at timestamptz);
 insert into public.customers(id,owner_id,name,nickname,contact) values('${uid(11)}','${uid(1)}','Old','Old','0911111111'),('${uid(12)}','${uid(1)}','Claim','Claim','0922222222'),('${uid(13)}','${uid(1)}','Bundle','Bundle','0933333333');
 insert into public.orders(id,owner_id,customer_id,status,claim_submission_id,bundle_claim_order_id) values('${uid(21)}','${uid(1)}','${uid(11)}','packed',null,null),('${uid(22)}','${uid(1)}','${uid(11)}','pending',null,null),('${uid(23)}','${uid(1)}','${uid(12)}','shipped',1,null),('${uid(24)}','${uid(1)}','${uid(13)}','packed',null,1);
 insert into public.claim_forms values(1,'${uid(1)}'),(2,'${uid(2)}');
 insert into public.claim_submissions values(1,1,'Claim','paid'),(2,2,'Foreign','pending');
 insert into public.bundle_claim_orders values(1,'${uid(1)}','Bundle','confirmed',now()),(2,'${uid(2)}','Foreign','confirmed',now()),(3,'${uid(1)}',null,'draft',now());
 grant usage on schema private,auth to authenticated;
 grant select on all tables in schema public to authenticated;
 select set_config('test.uid','${uid(1)}',false);
 `);
    await db.exec(
      await readFile(
        "supabase/migrations/20261105092535_edit_order_customer_names.sql",
        "utf8",
      ),
    );
    await db.exec(`
 create table public.name_sync_calls(source text);
 create function private.sync_claim_fulfillment(text,bigint) returns uuid language plpgsql as $$begin insert into public.name_sync_calls values($1);return null;end$$;
 create trigger name_claim after update on public.claim_submissions for each row execute function private.sync_claim_fulfillment_trigger();
 create trigger name_bundle after update on public.bundle_claim_orders for each row execute function private.sync_claim_fulfillment_trigger();
 `);
    await db.exec("set role authenticated");
    const rename = (
      source: string,
      id: string,
      expected: string,
      name: string,
      owner = uid(1),
    ) =>
      db.query("select public.update_order_customer_name($1,$2,$3,$4,$5)", [
        owner,
        source,
        id,
        expected,
        name,
      ]);
    await assert.rejects(
      rename("claim", "2", "Foreign", "Bad"),
      /name record not found/,
    );
    await assert.rejects(
      rename("bundle", "2", "Foreign", "Bad", uid(2)),
      /owner access required/,
    );
    await assert.rejects(
      rename("bundle", "3", "", "Bad"),
      /name record not found/,
    );
    await assert.rejects(
      rename("order", uid(23), "Claim", "Bad"),
      /edit name through source/,
    );
    await assert.rejects(
      rename("claim", "1", "Claim", " "),
      /invalid customer name/,
    );
    await assert.rejects(
      rename("claim", "1", "Wrong", "Correct"),
      /customer name changed/,
    );
    await rename("claim", "1", "Claim", "Claim Correct");
    await rename("bundle", "1", "Bundle", "Bundle Correct");
    const source = (
      await db.query<{ nickname: string; payment_status: string }>(
        "select nickname,payment_status from public.claim_submissions where id=1",
      )
    ).rows[0];
    assert.deepEqual(source, {
      nickname: "Claim Correct",
      payment_status: "paid",
    });
    const contacts = (
      await db.query<{ nickname: string; contact: string }>(
        "select nickname,contact from public.customers where id in ($1,$2) order by id",
        [uid(12), uid(13)],
      )
    ).rows;
    assert.deepEqual(contacts, [
      { nickname: "Claim Correct", contact: "0922222222" },
      { nickname: "Bundle Correct", contact: "0933333333" },
    ]);
    await db.exec("reset role");
    assert.equal(
      (
        await db.query<{ count: number }>(
          "select count(*)::int as count from public.name_sync_calls",
        )
      ).rows[0].count,
      0,
    );
    await db.exec("set role authenticated");
    await rename("order", uid(21), "Old", "Correct");
    await db.exec("reset role;update public.claim_submissions set payment_status='pending' where id=1;update public.claim_submissions set payment_status='paid' where id=1");
    assert.equal((await db.query<{count:number}>('select count(*)::int as count from public.name_sync_calls')).rows[0].count,2);
    await db.exec('set role authenticated');

    const orders = (
      await db.query<{
        id: string;
        name: string;
        contact: string;
        status: string;
      }>(
        `select o.id,c.name,c.contact,o.status from public.orders o join public.customers c on c.id=o.customer_id where o.id in ($1,$2) order by o.id`,
        [uid(21), uid(22)],
      )
    ).rows;
    assert.deepEqual(orders, [
      { id: uid(21), name: "Correct", contact: "0911111111", status: "packed" },
      { id: uid(22), name: "Old", contact: "0911111111", status: "pending" },
    ]);
    await assert.rejects(
      rename("order", uid(21), "Old", "Lost update"),
      /customer name changed/,
    );
    await db.exec(
      `reset role;create function private.reject_name() returns trigger language plpgsql as $$begin if new.name='Fail' then raise exception 'test failure';end if;return new;end$$;create trigger reject_name before update on public.customers for each row execute function private.reject_name();set role authenticated;`,
    );
    await assert.rejects(
      rename("claim", "1", "Claim Correct", "Fail"),
      /test failure/,
    );
    assert.equal(
      (
        await db.query<{ nickname: string }>(
          "select nickname from public.claim_submissions where id=1",
        )
      ).rows[0].nickname,
      "Claim Correct",
    );
    await db.exec("select set_config('test.uid','',false)");
    await assert.rejects(
      rename("claim", "1", "Claim Correct", "No"),
      /employee access required/,
    );
    await db.exec("reset role;set role anon");
    await assert.rejects(
      rename("claim", "1", "Claim Correct", "No"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
