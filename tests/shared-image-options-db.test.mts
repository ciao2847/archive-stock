import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const uid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
test("shared-image batches are atomic, scoped, retryable and protect images until their last reference is removed", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role authenticated; create role anon; create role service_role;
      create schema private; create schema auth; create schema storage;
      create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function public.my_role() returns text language sql as $$select 'staff'::text$$;
      create function private.current_inventory_owner_id() returns uuid language sql as $$select '${uid(1)}'::uuid$$;
      create table public.inventory_databases(id uuid primary key);
      create table public.profiles(id uuid primary key);
      create table public.products(id uuid primary key default gen_random_uuid(),owner_id uuid,name text,image_paths text[] default '{}');
      alter table public.products enable row level security;
      create policy own_products on public.products to authenticated using(owner_id=private.current_inventory_owner_id()) with check(owner_id=private.current_inventory_owner_id());
      create table storage.objects(bucket_id text,name text,owner_id text);
      alter table storage.objects enable row level security;
      create policy owned_images on storage.objects to authenticated using(owner_id=auth.uid()::text) with check(owner_id=auth.uid()::text);
      grant usage on schema public,private,auth,storage to authenticated;
      grant select,insert,update,delete on public.products,storage.objects to authenticated;
      grant select on public.inventory_databases,public.profiles to authenticated;
      insert into public.inventory_databases values('${uid(1)}'),('${uid(9)}');
      insert into public.profiles values('${uid(2)}');
      insert into storage.objects values('product-images','${uid(3)}/main.webp','${uid(2)}'),('product-images','${uid(3)}/thumb.webp','${uid(2)}'),('product-images','${uid(4)}/main.webp','${uid(9)}'),('product-images','${uid(4)}/thumb.webp','${uid(9)}');
      select set_config('request.jwt.claim.sub','${uid(2)}',false);
      -- Product creation boundary, isolated from unrelated stock/warehouse migrations.
      create function public.save_named_inventory_product(p_input jsonb,p_owner_id uuid)
      returns uuid language plpgsql security invoker set search_path='' as $$declare v_id uuid; begin
        insert into public.products(owner_id,name) values(p_owner_id,public.format_preorder_product_name(p_input->>'country',p_input->>'work',p_input->>'preorderItemName')) returning id into v_id;
        return v_id;
      end;$$;
    `);
    const naming = await readFile(
      "supabase/migrations/20261019003454_add_preorder_product_naming.sql",
      "utf8",
    );
    await db.exec(
      naming.slice(
        naming.indexOf("create function public.format_preorder_product_name"),
        naming.indexOf("-- The wrapper"),
      ),
    );
    await db.exec(
      await readFile(
        "supabase/migrations/20261019020507_add_preorder_text_batches.sql",
        "utf8",
      ),
    );
    await db.exec(
      await readFile(
        "supabase/migrations/20261111115841_shared_image_product_options.sql",
        "utf8",
      ),
    );
    await db.exec("set role authenticated");
    const items = [1, 2, 3].map((index) => ({
      work: "角色海報",
      country: "韓國",
      itemName: `第${index}款`,
      price: 350,
      size: "A3",
      format: "",
    }));
    const paths = [`${uid(3)}/main.webp`, `${uid(3)}/thumb.webp`];
    const create = async (
      batch: string,
      input: unknown = items,
      imagePaths: string[] | null = paths,
      owner = uid(1),
    ) => {
      return (
        await db.query<{ ids: string[] }>(
          "select public.create_shared_image_product_batch($1::uuid,$2::uuid,$3::jsonb,$4::text[]) ids",
          [owner, batch, JSON.stringify(input), imagePaths],
        )
      ).rows[0].ids;
    };
    const ids = await create(uid(5));
    assert.equal(ids.length, 3);
    assert.equal(
      (
        await db.query("select * from products where image_paths=$1::text[]", [
          paths,
        ])
      ).rows.length,
      3,
    );
    assert.deepEqual(await create(uid(5)), ids);
    // Manual SQL Editor installation can safely be run again after real data exists.
    await db.exec("reset role");
    await db.exec(
      await readFile(
        "supabase/migrations/20261111115841_shared_image_product_options.sql",
        "utf8",
      ),
    );
    await db.exec("set role authenticated");
    assert.deepEqual(await create(uid(5)), ids);
    await assert.rejects(
      create(uid(5), [{ ...items[0], price: 400 }, ...items.slice(1)]),
      /資料不一致/,
    );
    await assert.rejects(
      create(uid(6), items, paths, uid(9)),
      /owner access required/,
    );
    await assert.rejects(
      create(uid(6), items, [`${uid(4)}/main.webp`, `${uid(4)}/thumb.webp`]),
      /圖片不存在/,
    );
    await assert.rejects(create(uid(6), items, null), /主圖與縮圖/);
    await assert.rejects(
      create(uid(6), items, [paths[0], `${uid(4)}/thumb.webp`]),
      /主圖與縮圖/,
    );
    await assert.rejects(create(uid(6), [items[0]]), /2 至 50/);
    await assert.rejects(
      create(uid(6), [items[0], { ...items[1], work: "其他作品" }]),
      /相同作品/,
    );
    await assert.rejects(
      create(uid(6), [items[0], { ...items[1], price: -1 }]),
      /有效的 NT/,
    );
    assert.equal(
      (await db.query("select * from products")).rows.length,
      3,
      "failed second option rolls back the entire batch",
    );
    assert.equal(
      (await db.query("select * from private.preorder_product_batches")).rows
        .length,
      1,
    );
    // A later image edit must survive a response-loss retry of the original creation.
    await db.query("update products set image_paths='{}' where id=$1", [
      ids[0],
    ]);
    assert.deepEqual(await create(uid(5)), ids);
    assert.deepEqual(
      (
        await db.query<{ image_paths: string[] }>(
          "select image_paths from products where id=$1",
          [ids[0]],
        )
      ).rows[0].image_paths,
      [],
    );
    assert.equal(
      (
        await db.query(
          "delete from storage.objects where name=any($1::text[]) returning name",
          [paths],
        )
      ).rows.length,
      0,
    );
    await db.query("delete from products where id=$1", [ids[1]]);
    assert.equal(
      (
        await db.query(
          "delete from storage.objects where name=any($1::text[]) returning name",
          [paths],
        )
      ).rows.length,
      0,
      "deleting one style retains shared images",
    );
    await db.query("delete from products where id=$1", [ids[2]]);
    assert.equal(
      (
        await db.query(
          "delete from storage.objects where name=any($1::text[]) returning name",
          [paths],
        )
      ).rows.length,
      2,
      "last reference permits cleanup",
    );
    // Restrictive guard must also see references outside the caller's product RLS.
    await db.exec(
      `reset role; insert into products(owner_id,name,image_paths) values('${uid(9)}','Other inventory',array['${uid(3)}/main.webp']); insert into storage.objects values('product-images','${uid(3)}/main.webp','${uid(2)}'); set role authenticated;`,
    );
    assert.equal(
      (
        await db.query(
          "delete from storage.objects where name=$1 returning name",
          [paths[0]],
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query<{ allowed: boolean }>(
          "select has_function_privilege('anon','public.create_shared_image_product_batch(uuid,uuid,jsonb,text[])','EXECUTE') allowed",
        )
      ).rows[0].allowed,
      false,
    );
  } finally {
    await db.close();
  }
});
