import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const state = globalThis as typeof globalThis & { receivingAuth: unknown };
const bundle = await build({
  entryPoints: ["src/app/api/bundle-claims/route.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  plugins: [
    {
      name: "receiving-auth-fixture",
      setup(builder) {
        builder.onResolve({ filter: /api\/server-auth$/ }, () => ({
          path: "auth",
          namespace: "fixture",
        }));
        builder.onResolve(
          { filter: /^server-only$|utils\/supabase\/service$/ },
          () => ({ path: "service", namespace: "fixture" }),
        );
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({
          contents:
            path === "auth"
              ? `export const requireApiUser=async()=>globalThis.receivingAuth;export const apiSuccess=(data,status=200)=>Response.json({success:true,data},{status});export const apiFailure=(error,status)=>Response.json({success:false,error},{status});export const withApiErrorHandling=async(_,callback)=>callback();`
              : "export function createServiceClient(){throw new Error('Receipt must use authenticated client');}",
        }));
      },
    },
  ],
});
const { PATCH } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const owner = "00000000-0000-4000-8000-000000000001";
function fixture(
  options: {
    copyError?: string;
    mapped?: boolean;
    missingDetails?: boolean;
    mismatch?: boolean;
  } = {},
) {
  const copies: unknown[][] = [],
    calls: unknown[][] = [],
    filters: unknown[][] = [];
  const chain = {
    select() {
      return chain;
    },
    eq(...args: unknown[]) {
      filters.push(args);
      return chain;
    },
    async maybeSingle() {
      return {
        error: null,
        data: {
          status: "confirmed",
          total_amount: options.mismatch ? 100 : 700.25,
          bundle_fulfillment_items: options.mapped
            ? [{ product_id: "existing" }]
            : [],
          bundle_claim_order_images: [
            {
              id: 9,
              storage_path: `${owner}/3/source.png`,
              product_name: options.missingDetails ? null : "龍貓",
              product_amount: 700.25,
              received_product_id: null,
            },
          ],
        },
      };
    },
  };
  state.receivingAuth = {
    ok: true,
    role: "staff",
    inventoryOwnerId: owner,
    supabase: {
      from() {
        return chain;
      },
      storage: {
        from(bucket: string) {
          return {
            async copy(...args: unknown[]) {
              copies.push([bucket, ...args]);
              return {
                error: options.copyError
                  ? { statusCode: options.copyError }
                  : null,
              };
            },
          };
        },
      },
      async rpc(...args: unknown[]) {
        calls.push(args);
        return { error: null };
      },
    },
  };
  return { copies, calls, filters };
}
function request(checked = true, ownerId = owner) {
  return PATCH(
    new Request("http://localhost/api/bundle-claims", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "set_receiving",
        ownerId,
        orderId: 3,
        checked,
      }),
    }),
  );
}

test("receipt copies source images into inventory storage before the transactional RPC", async () => {
  const f = fixture();
  assert.equal((await request()).status, 200);
  assert.deepEqual(f.filters, [
    ["owner_id", owner],
    ["id", 3],
  ]);
  assert.deepEqual(f.copies, [
    [
      "bundle-claim-screenshots",
      `${owner}/3/source.png`,
      `${owner}/bundle-receiving/3/9`,
      { destinationBucket: "product-images" },
    ],
  ]);
  assert.deepEqual(f.calls, [
    [
      "set_bundle_claim_receiving_check",
      { p_owner_id: owner, p_order_id: 3, p_checked: true },
    ],
  ]);
});
test("receipt retry reuses a prepared image, while a copy failure never checks the order", async () => {
  let f = fixture({ copyError: "409" });
  assert.equal((await request()).status, 200);
  assert.equal(f.calls.length, 1);
  f = fixture({ copyError: "503" });
  const result = await request();
  assert.equal(result.status, 400);
  assert.match((await result.json()).error, /圖片複製失敗/);
  assert.equal(f.calls.length, 0);
});
test("incomplete or mismatched product details stop receipt before copying or changing inventory", async () => {
  for (const options of [{ missingDetails: true }, { mismatch: true }]) {
    const f = fixture(options);
    assert.equal((await request()).status, 400);
    assert.deepEqual(f.copies, []);
    assert.deepEqual(f.calls, []);
  }
});
test("mapped receipts and check reversal skip preparation without receiving stock again", async () => {
  let f = fixture({ mapped: true, missingDetails: true });
  assert.equal((await request()).status, 200);
  assert.deepEqual(f.copies, []);
  f = fixture();
  assert.equal((await request(false)).status, 200);
  assert.deepEqual(f.filters, []);
  assert.deepEqual(f.copies, []);
  assert.deepEqual(f.calls, [
    [
      "set_bundle_claim_receiving_check",
      { p_owner_id: owner, p_order_id: 3, p_checked: false },
    ],
  ]);
});
test("foreign inventory cannot prepare images or receive products", async () => {
  const f = fixture();
  assert.equal(
    (await request(true, "00000000-0000-4000-8000-000000000002")).status,
    403,
  );
  assert.deepEqual(f.copies, []);
  assert.deepEqual(f.calls, []);
});
