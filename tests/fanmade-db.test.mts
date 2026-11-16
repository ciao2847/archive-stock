import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type {
  FanmadeManagement,
  FanmadeProduct,
  FanmadeGroup,
} from "../src/lib/fanmade/types";
import type { ClaimProcurementData } from "../src/lib/claim-procurement";
type DbResult = FanmadeManagement & {
  formId: number;
  productIds: string[];
  groups: FanmadeGroup[];
  hasMore: boolean;
  bucket: string;
  path: string;
  leaseToken: string;
  id: string;
};
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const migration =
  "supabase/migrations/20261114140129_fanmade_catalog_stock_and_media.sql";
test("fanmade stock, separate craft SKUs, retry, scope, pagination, video leases and existing packing remain consistent", async () => {
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
    // Exercise the real creation, public submit, and claim -> fulfillment projection.
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
    await db.exec(
      "create table public.claim_submission_payments(id bigint generated always as identity primary key,submission_id bigint references public.claim_submissions(id) on delete cascade,amount numeric not null)",
    );
    await db.exec(`alter table public.claim_submissions add payment_status text default 'pending';
      alter table public.customers add owner_id uuid,add nickname text,add created_by uuid;
      alter table public.orders add created_by uuid,add claim_submission_id bigint unique references public.claim_submissions(id) on delete cascade,add bundle_claim_order_id bigint;
      alter table public.order_items add unit_price numeric default 0;
      create table public.packing_package_items(order_id uuid);
      create table public.settlement_orders(order_id uuid);
      create table public.product_qr_labels(product_id uuid,batch_code text);
      grant select,insert,update,delete on all tables in schema public to authenticated;
      grant usage on all sequences in schema public to authenticated;`);
    await db.exec(
      await readFile(
        "supabase/migrations/20261008020858_simplify_product_intake.sql",
        "utf8",
      ),
    );
    const submit = await readFile(
      "supabase/migrations/20261002001346_add_inventory_line_and_claim_product_availability.sql",
      "utf8",
    );
    await db.exec(
      submit.slice(
        submit.indexOf(
          "create or replace function public.submit_public_claim(",
        ),
        submit.indexOf("notify pgrst"),
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
    await db.exec(await readFile(migration, "utf8"));
    await db.exec(
      await readFile(
        "supabase/migrations/20261115064319_claim_procurement_rounds.sql",
        "utf8",
      ),
    );
    await db.exec(
      await readFile(
        "supabase/migrations/20261115064329_fanmade_catalog_groups.sql",
        "utf8",
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
    await db.exec("set role authenticated");
    const manage = async (
      action: string,
      input: unknown = {},
      owner = id(10),
    ) =>
      (
        await db.query<{ data: DbResult }>(
          "select public.manage_fanmade($1,$2,$3::jsonb) data",
          [owner, action, JSON.stringify(input)],
        )
      ).rows[0].data;
    await assert.rejects(manage("list", {}, id(20)), /owner access required/);
    await manage("price", { price: 350 });
    const form = await manage("create_form", { title: "多 IP 飯製" });
    const items = Array.from({ length: 14 }, (_, i) => ({
      ip: i === 13 ? "另一個 IP" : "蜘蛛人",
      title: "夜景款" + i,
      craft: i === 1 ? "水波紋" : "亮銀龍",
      stock: 10,
      imagePaths: [`${id(100 + i)}/main.webp`, `${id(100 + i)}/thumb.webp`],
    }));
    await db.exec("reset role");
    for (const item of items)
      for (const path of item.imagePaths)
        await db.query(
          "insert into storage.objects values('product-images',$1,$2)",
          [path, id(1)],
        );
    await db.exec("set role authenticated");
    const result = await manage("batch", { requestId: id(50), items });
    assert.equal(result.productIds.length, 14);
    assert.deepEqual(
      (await manage("batch", { requestId: id(50), items })).productIds,
      result.productIds,
    );
    await assert.rejects(
      manage("batch", {
        requestId: id(50),
        items: [{ ...items[0], stock: 9 }],
      }),
      /批次資料不一致/,
    );
    const product = result.productIds[0];
    await manage("publish", {
      formId: form.formId,
      productIds: result.productIds,
    });
    const list = await manage("list", { formId: form.formId });
    assert.equal(list.total, 14);
    assert.equal(list.products[0].stock, 10);
    assert.equal(
      list.products.every((p: FanmadeProduct) => p.listed),
      true,
    );
    const token = (
      await db.query<{ public_token: string }>(
        "select public_token from claim_forms where id=$1",
        [form.formId],
      )
    ).rows[0].public_token;
    const header = (
      await db.query<{ data: DbResult }>(
        "select public.get_fanmade_header($1) data",
        [token],
      )
    ).rows[0].data;
    assert.equal(header.groups.length, 2);
    assert.equal(JSON.stringify(header).includes("imagePaths"), false);
    const ip = header.groups.find((g: FanmadeGroup) => g.name === "蜘蛛人").id;
    const page = await db.query<{ data: DbResult }>(
      "select public.get_fanmade_page($1,$2,1) data",
      [token, ip],
    );
    assert.equal(page.rows[0].data.products.length, 12);
    assert.equal(page.rows[0].data.hasMore, true);
    assert.equal(
      JSON.stringify(page.rows[0].data).includes("source_path"),
      false,
    );

    assert.equal(
      (
        await db.query<{ data: DbResult }>(
          "select get_fanmade_page($1,$2,2) data",
          [token, ip],
        )
      ).rows[0].data.products.length,
      1,
    );
    // Exercise reservation, cancellation, and the existing packing function.
    await db.query("insert into orders(id,owner_id) values($1,$2),($3,$2)", [
      id(60),
      id(10),
      id(61),
    ]);
    await db.query(
      "insert into order_items(order_id,product_id,quantity) values($1,$2,7)",
      [id(60), product],
    );
    await assert.rejects(
      db.query(
        "insert into order_items(order_id,product_id,quantity) values($1,$2,4)",
        [id(61), product],
      ),
      /庫存不足/,
    );
    await assert.rejects(
      manage("stock", { productId: product, stock: 6, reason: "盤點" }),
      /不可低於已預留/,
    );
    await db.query(
      "update order_items set scanned_quantity=7 where order_id=$1",
      [id(60)],
    );
    await db.query("select complete_order_packing($1)", [id(60)]);
    let current = (await manage("list")).products.find((p) => p.id === product);
    assert.equal(current.stock, 3);
    assert.equal(current.reserved, 0);
    await db.query(
      "insert into order_items(order_id,product_id,quantity) values($1,$2,3)",
      [id(61), product],
    );
    await db.query("update orders set status='cancelled' where id=$1", [
      id(61),
    ]);
    await manage("stock", { productId: product, stock: 1, reason: "盤點" });
    await assert.rejects(
      db.query("update orders set status='pending' where id=$1", [id(61)]),
      /不可低於已預留/,
    );
    // Real public submit -> claim snapshots -> fulfillment -> payment -> packing.
    await manage("form", {
      formId: form.formId,
      title: "飯製訂購",
      isOpen: true,
    });
    const claimItems = [
      { product_id: result.productIds[2], quantity: 7 },
      { product_id: result.productIds[3], quantity: 8 },
    ];
    const submitClaim = async (
      requestId: string,
      price = 350,
      selected = claimItems,
    ) =>
      (
        await db.query<{ confirmation_code: string }>(
          "select * from submit_fanmade_claim($1,'小明','0912345678','',$2,$3::jsonb,$4)",
          [token, requestId, JSON.stringify(selected), price],
        )
      ).rows[0];
    const receipt = await submitClaim(id(501));
    assert.ok(receipt.confirmation_code);
    assert.deepEqual(await submitClaim(id(501)), receipt);
    const claimProducts = (await manage("list")).products;
    assert.equal(
      claimProducts.find((p) => p.id === result.productIds[2]).reserved,
      7,
    );
    assert.equal(
      claimProducts.find((p) => p.id === result.productIds[3]).reserved,
      8,
    );
    await assert.rejects(
      submitClaim(id(502), 350, [
        { product_id: result.productIds[2], quantity: 4 },
      ]),
      /庫存不足/,
    );
    await manage("price", { price: 450 });
    await assert.rejects(submitClaim(id(502)), /價格已更新/);
    assert.deepEqual(
      await submitClaim(id(501)),
      receipt,
      "lost response returns its old receipt after a price change",
    );
    assert.equal(
      Number(
        (
          await db.query<{ unit_price: number }>(
            "select unit_price from claim_submission_items where product_id=$1",
            [result.productIds[2]],
          )
        ).rows[0].unit_price,
      ),
      350,
    );
    const projected = (
      await db.query<{ id: string }>(
        "select o.id from orders o join claim_submissions s on s.id=o.claim_submission_id where s.request_id=$1",
        [id(501)],
      )
    ).rows[0].id;
    await db.query(
      "update claim_submissions set payment_status='paid' where request_id=$1",
      [id(501)],
    );
    assert.equal(
      (
        await db.query<{ payment_status: string }>(
          "select payment_status from orders where id=$1",
          [projected],
        )
      ).rows[0].payment_status,
      "paid",
    );
    await db.query(
      "update order_items set scanned_quantity=quantity where order_id=$1",
      [projected],
    );
    await db.query("select complete_order_packing($1)", [projected]);
    current = (await manage("list")).products.find(
      (p) => p.id === result.productIds[2],
    );
    assert.equal(current.stock, 3);
    assert.equal(current.reserved, 0);
    // Legacy stock moves in place, never duplicates; foreign parents are denied.
    await db.exec("reset role");
    await db.query(
      "insert into products(id,owner_id,name,category,country,stock,poster_crafts) values($1,$2,'舊飯製','海報','飯製',9,array['亮銀龍','水波紋']),($3,$4,'其他庫藏','海報','飯製',5,array['亮銀龍'])",
      [id(700), id(10), id(701), id(20)],
    );
    await db.exec("set role authenticated");
    await assert.rejects(
      db.query(
        "insert into fanmade_details(product_id,owner_id,title,craft) values($1,$2,'偽造','亮銀龍')",
        [id(701), id(10)],
      ),
      /owner mismatch/,
    );
    const ordinary = (
      await db.query<{ id: number }>(
        "insert into claim_forms(owner_id,title) values($1,'舊表單') returning id",
        [id(10)],
      )
    ).rows[0].id;
    await db.query(
      "insert into claim_form_products(form_id,product_id,display_name,unit_price) values($1,$2,'舊飯製',350)",
      [ordinary, id(700)],
    );
    await assert.rejects(
      db.query("insert into fanmade_forms(form_id,owner_id) values($1,$2)", [
        ordinary,
        id(20),
      ]),
      /mismatch|policy/,
    );
    await manage("migrate", { productId: id(700), craft: "亮銀龍" });
    current = (await manage("list")).products.find((p) => p.id === id(700));
    assert.equal(current.stock, 9);
    assert.equal((await manage("list")).total, 15);
    assert.equal(
      (
        await db.query(
          "select * from claim_form_products where form_id=$1 and product_id=$2",
          [ordinary, id(700)],
        )
      ).rows.length,
      0,
    );
    // Private video originals, stale leases, retries, and token scoping.
    const source = id(10) + "/" + id(80) + "/source.mov";
    await db.exec("reset role");
    await db.query(
      "insert into storage.objects values('fanmade-video-originals',$1,$2)",
      [source, id(1)],
    );
    await db.exec("set role authenticated");
    await manage("video", { productId: product, sourcePath: source });
    await assert.rejects(
      db.query("select claim_fanmade_video_job()"),
      /permission denied/,
    );
    await db.exec("reset role");
    const first = (
      await db.query<{ j: DbResult }>("select claim_fanmade_video_job() j")
    ).rows[0].j;
    await db.query("select finish_fanmade_video_job($1,$2,'fixture failure')", [
      first.id,
      first.leaseToken,
    ]);
    await db.exec("set role authenticated");
    await manage("retry_video", { productId: product });
    await db.exec("reset role");
    const retry = (
      await db.query<{ j: DbResult }>("select claim_fanmade_video_job() j")
    ).rows[0].j;
    assert.notEqual(retry.id, first.id);
    assert.equal(
      (
        await db.query<{ done: boolean }>(
          "select finish_fanmade_video_job($1,$2,null,10,100) done",
          [first.id, first.leaseToken],
        )
      ).rows[0].done,
      false,
    );
    await db.query(
      "update private.fanmade_video_jobs set lease_until=now()-interval '1 second' where id=$1",
      [retry.id],
    );
    const reclaimed = (
      await db.query<{ j: DbResult }>("select claim_fanmade_video_job() j")
    ).rows[0].j;
    assert.equal(reclaimed.id, retry.id);
    assert.notEqual(reclaimed.leaseToken, retry.leaseToken);
    assert.equal(
      (
        await db.query<{ done: boolean }>(
          "select finish_fanmade_video_job($1,$2,null,10,100) done",
          [retry.id, retry.leaseToken],
        )
      ).rows[0].done,
      false,
    );
    await db.query("select finish_fanmade_video_job($1,$2,null,10,100)", [
      reclaimed.id,
      reclaimed.leaseToken,
    ]);
    const media = (
      await db.query<{ data: DbResult }>(
        "select get_fanmade_media($1,$2,'video') data",
        [token, product],
      )
    ).rows[0].data;
    assert.equal(media.bucket, "fanmade-video-playback");
    assert.match(media.path, new RegExp(reclaimed.leaseToken));
    assert.equal(
      (
        await db.query<{ data: DbResult }>(
          "select get_fanmade_media($1,$2,'video') data",
          [id(99), product],
        )
      ).rows[0].data,
      null,
    );
    await db.exec("set role authenticated");
    await assert.rejects(
      db.query(
        "update fanmade_details set video_job_id=$1 where product_id=$2",
        [retry.id, id(700)],
      ),
      /video product mismatch/,
    );
    assert.equal(
      (
        await db.query<{ allowed: boolean }>(
          "select has_function_privilege('anon','public.manage_fanmade(uuid,text,jsonb)','EXECUTE') allowed",
        )
      ).rows[0].allowed,
      false,
    );
    // Both new migrations also run with the full fanmade reservation and packing pipeline.
    const procurement = (
      await db.query<{ data: ClaimProcurementData }>(
        "select get_claim_procurement($1,$2) data",
        [id(10), form.formId],
      )
    ).rows[0].data;
    assert.equal(procurement.current.itemCount, 15);
    await db.query("select close_claim_procurement($1,$2,$3,$4)", [
      id(10),
      form.formId,
      procurement.current.id,
      id(990),
    ]);
    const closed = (
      await db.query<{ data: ClaimProcurementData }>(
        "select get_claim_procurement($1,$2,$3) data",
        [id(10), form.formId, procurement.current.id],
      )
    ).rows[0].data;
    assert.equal(closed.selected.itemCount, 15);
    assert.equal(closed.current.itemCount, 0);
    assert.equal(
      (await manage("list")).products.find((p) => p.id === result.productIds[2])
        .stock,
      3,
      "closing procurement must not deduct fanmade stock again",
    );
  } finally {
    await db.close();
  }
});
