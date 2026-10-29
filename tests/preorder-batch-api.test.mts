import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
const state = globalThis as typeof globalThis & {
  batchAuth: {
    ok: boolean;
    role?: "staff" | "admin";
    inventoryOwnerId?: string;
    response?: Response;
    supabase?: unknown;
  };
  batchCalls: Array<[string, Record<string, unknown>]>;
  batchResult: {
    data: unknown;
    error: { code: string; message: string } | null;
  };
};
const bundle = await build({
  entryPoints: ["src/app/api/products/preorder-batch/route.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  plugins: [
    {
      name: "auth-fixture",
      setup(builder) {
        builder.onResolve({ filter: /api\/server-auth$/ }, () => ({
          path: "auth",
          namespace: "fixture",
        }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: `export const requireApiUser=async()=>globalThis.batchAuth;export const apiSuccess=(data,status=200)=>Response.json({success:true,data},{status});export const apiFailure=(error,status)=>Response.json({success:false,error},{status});export const withApiErrorHandling=async(_,callback)=>callback();`,
        }));
      },
    },
  ],
});
const { POST } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const owner = "00000000-0000-4000-8000-000000000001",
  other = "00000000-0000-4000-8000-000000000002",
  batch = "00000000-0000-4000-8000-000000000003";
const item = {
  work: "蜘蛛人",
  country: "韓國",
  itemName: "A款",
  price: 350,
  size: "A3",
  format: "IMAX",
};
const input = { ownerId: owner, requestId: batch, items: [item] };
function fixture() {
  state.batchCalls = [];
  state.batchResult = { data: [other], error: null };
  state.batchAuth = {
    ok: true,
    role: "staff",
    inventoryOwnerId: owner,
    supabase: {
      rpc: async (...args: [string, Record<string, unknown>]) => {
        state.batchCalls.push(args);
        return state.batchResult;
      },
    },
  };
}
const request = (body: unknown = input, headers: Record<string, string> = {}) =>
  new Request("https://example.com/api/products/preorder-batch", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
test("batch API authenticates and scopes requests before any writes", async () => {
  fixture();
  state.batchAuth = {
    ok: false,
    response: new Response(null, { status: 401 }),
  };
  assert.equal((await POST(request())).status, 401);
  assert.equal(state.batchCalls.length, 0);
  fixture();
  assert.equal((await POST(request({ ...input, ownerId: other }))).status, 403);
  assert.equal(
    (await POST(request(input, { origin: "https://evil.example" }))).status,
    403,
  );
  assert.equal(
    (await POST(request(input, { "sec-fetch-site": "cross-site" }))).status,
    403,
  );
  assert.equal(state.batchCalls.length, 0);
});
test("batch validation rejects incomplete, duplicate and oversized lists", async () => {
  fixture();
  for (const items of [
    [],
    Array(51).fill(item),
    [item, item],
    [{ ...item, country: "" }],
    [{ ...item, price: -1 }],
    [{ ...item, price: 1.234 }],
    [
      { ...item, itemName: "" },
      { ...item, country: "日本" },
    ],
    [{ ...item, format: "bad" }],
  ])
    assert.equal((await POST(request({ ...input, items }))).status, 400);
  assert.equal(state.batchCalls.length, 0);
});
test("valid batches use one atomic RPC and stable retry ID, excluding arbitrary product fields", async () => {
  fixture();
  const response = await POST(
    request({
      ...input,
      items: [{ ...item, stock: 99, ownerId: other, imagePaths: ["secret"] }],
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, {
    batchId: batch,
    productIds: [other],
  });
  assert.deepEqual(state.batchCalls[0], [
    "create_preorder_product_batch",
    { p_owner_id: owner, p_batch_id: batch, p_items: [item] },
  ]);
  await POST(request());
  assert.equal(state.batchCalls[1][1].p_batch_id, batch);
  fixture();
  state.batchAuth.role = "admin";
  assert.equal((await POST(request({ ...input, ownerId: other }))).status, 200);
});
test("conflicting receipts and unknown results retain their retry semantics", async () => {
  fixture();
  state.batchResult = {
    data: null,
    error: { code: "22023", message: "conflict" },
  };
  assert.equal((await POST(request())).status, 409);
  state.batchResult = { data: [], error: null };
  assert.equal((await POST(request())).status, 503);
  state.batchResult = {
    data: null,
    error: { code: "P0001", message: "invalid price" },
  };
  assert.equal((await POST(request())).status, 400);
});
