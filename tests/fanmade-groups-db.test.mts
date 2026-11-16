import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type {
  FanmadeManagement,
  FanmadePage,
  FanmadeHeader,
} from "../src/lib/fanmade/types";
const id = (n: number) =>
  "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
test("fanmade catalog groups preserve variant SKUs and paginate whole designs with scoped media and management", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema private;create schema storage;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table auth.users(id uuid primary key);`);
    let schema = await readFile("supabase/legacy/schema.sql", "utf8");
    schema = schema.replace("create extension if not exists pgcrypto;", "");
    await db.exec(
      schema.slice(
        0,
        schema.indexOf("create or replace function public.my_role()"),
      ),
    );
    await db.exec(`
 create table public.inventory_databases(id uuid primary key,name text,official_line_id text,claim_completion_message text,claim_banner_image_path text,claim_banner_position_x smallint,claim_banner_position_y smallint,claim_theme_primary_color text,claim_theme_background_color text,claim_theme_surface_color text,claim_theme_header_text_color text);
 alter table public.profiles add inventory_owner_id uuid;
 alter table public.products add owner_id uuid,add description text,add preorder_item_name text;
 alter table public.orders add owner_id uuid,add deleted_at timestamptz;
 alter table public.order_items add packed_quantity integer not null default 0;
 create function public.my_role() returns public.user_role language sql stable security definer set search_path='' as $$select role from public.profiles where id=auth.uid()$$;
 create function private.current_inventory_owner_id() returns uuid language sql stable security definer set search_path='' as $$select inventory_owner_id from public.profiles where id=auth.uid()$$;
 create table public.claim_forms(id bigint generated always as identity primary key,owner_id uuid,public_token uuid unique default gen_random_uuid(),title text,is_open boolean default false,description text,closes_at timestamptz,created_by uuid,updated_at timestamptz default now());
 create table public.claim_form_products(form_id bigint references public.claim_forms(id),product_id uuid references public.products(id),display_name text,unit_price numeric,max_quantity_per_customer integer default 20,is_enabled boolean default true,sort_order integer default 0,primary key(form_id,product_id));
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(bucket_id text,name text,owner_id text);
 create function public.submit_public_claim(p_token uuid,p_nickname text,p_phone text,p_notes text,p_request_id uuid,p_items jsonb) returns table(confirmation_code text,submitted_at timestamptz) language sql as $$select 'TEST',now()$$;
 insert into auth.users values('${id(1)}'),('${id(2)}');
 insert into public.inventory_databases(id,name) values('${id(10)}','First'),('${id(20)}','Second');
 insert into public.profiles(id,display_name,inventory_owner_id) values('${id(1)}','First','${id(10)}'),('${id(2)}','Second','${id(20)}');
 create function public.create_inventory_product(p_name text,p_work text,p_category text,p_country text,p_source text,p_location text,p_stock integer,p_price numeric,p_cost numeric,p_image_paths text[],p_poster_format text,p_poster_size text,p_poster_crafts text[],p_identifying_features text,p_owner_id uuid,p_description text default null)
 returns uuid language plpgsql security invoker set search_path='' as $$declare w uuid;p uuid;begin
 select id into w from public.works where title_zh=p_work limit 1;if w is null then insert into public.works(title_zh) values(p_work) returning id into w;end if;
 insert into public.products(owner_id,name,work_id,category,country,stock,price,image_paths,poster_crafts) values(p_owner_id,p_name,w,p_category,p_country,p_stock,p_price,p_image_paths,p_poster_crafts) returning id into p;return p;end$$;
 grant usage on schema public,private,auth,storage to authenticated;
 grant select,insert,update,delete on all tables in schema public to authenticated;
 grant select on storage.objects to authenticated;
 grant usage on all sequences in schema public to authenticated;
 alter table public.products enable row level security;create policy own_product on public.products to authenticated using(owner_id=private.current_inventory_owner_id()) with check(owner_id=private.current_inventory_owner_id());
 select set_config('request.jwt.claim.sub','${id(1)}',false);
 `);

    await db.exec(
      await readFile(
        "supabase/migrations/20261114140129_fanmade_catalog_stock_and_media.sql",
        "utf8",
      ),
    );
    await db.exec("set role authenticated");
    type Result = FanmadeManagement & { productIds: string[]; formId: number };
    const manage = async (
      action: string,
      input: unknown = {},
      owner = id(10),
    ) =>
      (
        await db.query<{ data: Result }>(
          "select manage_fanmade($1,$2,$3::jsonb) data",
          [owner, action, JSON.stringify(input)],
        )
      ).rows[0].data;
    await manage("price", { price: 350 });
    const form = await manage("create_form", { title: "多工藝" });
    const items = Array.from({ length: 26 }, (_, i) => ({
      ip: "蜘蛛人",
      title: "海報" + Math.floor(i / 2),
      craft: i % 2 ? "水波紋" : "亮銀龍",
      stock: i % 2 ? 6 : 10,
      imagePaths: [
        id(100 + Math.floor(i / 2)) + "/main.webp",
        id(100 + Math.floor(i / 2)) + "/thumb.webp",
      ],
    }));
    await db.exec("reset role");
    for (const path of new Set(items.flatMap((p) => p.imagePaths)))
      await db.query(
        "insert into storage.objects values('product-images',$1,$2)",
        [path, id(1)],
      );
    await db.exec("set role authenticated");
    const batch = await manage("batch", { requestId: id(40), items });
    await manage("publish", {
      formId: form.formId,
      productIds: batch.productIds,
    });
    const token = (
      await db.query<{ public_token: string }>(
        "select public_token from claim_forms where id=$1",
        [form.formId],
      )
    ).rows[0].public_token;
    await db.exec("reset role");
    await db.exec(
      await readFile(
        "supabase/migrations/20261115064329_fanmade_catalog_groups.sql",
        "utf8",
      ),
    );
    await db.exec("set role authenticated");
    const header = (
      await db.query<{ data: FanmadeHeader }>(
        "select get_fanmade_header($1) data",
        [token],
      )
    ).rows[0].data;
    assert.equal(header.groups[0].count, 13);
    assert.equal(header.groups[0].variantCount, 26);
    const ip = header.groups[0].id;
    const page = async (n: number, query = "") =>
      (
        await db.query<{ data: FanmadePage }>(
          "select get_fanmade_page($1,$2,$3,$4) data",
          [token, ip, n, query],
        )
      ).rows[0].data;
    const first = await page(1),
      second = await page(2);
    assert.equal(first.total, 13);
    assert.equal(first.products.length, 24);
    assert.equal(first.hasMore, true);
    assert.equal(second.products.length, 2);
    assert.equal(second.hasMore, false);
    assert.equal(
      new Set([...first.products, ...second.products].map((p) => p.id)).size,
      26,
    );
    for (const group of new Set(first.products.map((p) => p.catalogGroupId)))
      assert.equal(
        first.products.filter((p) => p.catalogGroupId === group).length,
        2,
      );
    const bright = first.products.find((p) => p.craft === "亮銀龍")!,
      wave = first.products.find(
        (p) =>
          p.catalogGroupId === bright.catalogGroupId && p.craft === "水波紋",
      )!;
    assert.notEqual(bright.id, wave.id);
    assert.equal(bright.available, 10);
    assert.equal(wave.available, 6);
    assert.equal(
      (await page(1, "水波紋")).products.length,
      24,
      "craft search still returns the complete matching designs",
    );
    const catalog = async (owner = id(10), pageNo = 1) =>
      (
        await db.query<{ data: FanmadeManagement }>(
          "select get_fanmade_catalog($1,$2,'',$3) data",
          [owner, pageNo, form.formId],
        )
      ).rows[0].data;
    let admin = await catalog();
    assert.equal(admin.total, 13);
    assert.equal(admin.variantTotal, 26);
    assert.equal(admin.products.length, 26);
    await assert.rejects(catalog(id(20)), /owner access required/);
    // New batches automatically group; repeating the same title in another IP or photo stays separate.
    await db.exec("reset role");
    await db.query(
      "insert into storage.objects values('product-images',$1,$2),('product-images',$3,$2)",
      [id(900) + "/main.webp", id(1), id(900) + "/thumb.webp"],
    );
    await db.exec("set role authenticated");
    const more = await manage("batch", {
      requestId: id(41),
      items: [
        { ...items[0], ip: "蝙蝠俠" },
        {
          ...items[0],
          imagePaths: [id(900) + "/main.webp", id(900) + "/thumb.webp"],
        },
      ],
    });
    admin = await catalog();
    assert.equal(admin.total, 15);
    assert.equal(admin.products.length, 28);
    const groupId = (
      await db.query<{ catalog_group_id: string }>(
        "select catalog_group_id from fanmade_details where product_id=$1",
        [bright.id],
      )
    ).rows[0].catalog_group_id;
    await db.query(
      "update fanmade_details set catalog_group_id=$1 where product_id=$2",
      [id(999), bright.id],
    );
    assert.equal(
      (
        await db.query<{ catalog_group_id: string }>(
          "select catalog_group_id from fanmade_details where product_id=$1",
          [bright.id],
        )
      ).rows[0].catalog_group_id,
      groupId,
      "caller supplied group IDs are ignored",
    );
    await db.query(
      "update fanmade_details set craft='新工藝' where product_id=$1",
      [bright.id],
    );
    assert.equal(
      (
        await db.query<{ catalog_group_id: string }>(
          "select catalog_group_id from fanmade_details where product_id=$1",
          [bright.id],
        )
      ).rows[0].catalog_group_id,
      groupId,
    );
    await db.query(
      "update fanmade_details set title='不同畫稿' where product_id=$1",
      [bright.id],
    );
    assert.notEqual(
      (
        await db.query<{ catalog_group_id: string }>(
          "select catalog_group_id from fanmade_details where product_id=$1",
          [bright.id],
        )
      ).rows[0].catalog_group_id,
      groupId,
    );
    await db.query("update products set image_paths=$1 where id=$2", [
      [id(900) + "/main.webp", id(900) + "/thumb.webp"],
      wave.id,
    ]);
    assert.notEqual(
      (
        await db.query<{ catalog_group_id: string }>(
          "select catalog_group_id from fanmade_details where product_id=$1",
          [wave.id],
        )
      ).rows[0].catalog_group_id,
      groupId,
      "photo edits regroup the SKU",
    );
    // Image-less legacy designs stay separate even when names and IP match.
    await db.exec("reset role");
    await db.query(
      "insert into products(id,owner_id,name,category,country,work_id,stock) values($1,$3,'舊品','海報','飯製',$4,2),($2,$3,'舊品','海報','飯製',$4,3)",
      [id(701), id(702), id(10), ip],
    );
    await db.exec("set role authenticated");
    await manage("migrate", { productId: id(701), craft: "亮銀龍" });
    await manage("migrate", { productId: id(702), craft: "水波紋" });
    const noImages = (
      await db.query<{ catalog_group_id: string }>(
        "select catalog_group_id from fanmade_details where product_id=any($1::uuid[])",
        [[id(701), id(702)]],
      )
    ).rows;
    assert.equal(new Set(noImages.map((p) => p.catalog_group_id)).size, 2);
    assert.equal(
      (
        await db.query<{ allowed: boolean }>(
          "select has_function_privilege('anon','public.get_fanmade_catalog(uuid,integer,text,bigint)','EXECUTE') allowed",
        )
      ).rows[0].allowed,
      false,
    );
    assert.equal(
      (
        await db.query<{ data: unknown }>(
          "select get_fanmade_page($1,$2,1,'') data",
          [id(999), ip],
        )
      ).rows[0].data,
      null,
    );
    assert.equal(more.productIds.length, 2);
  } finally {
    await db.close();
  }
});
