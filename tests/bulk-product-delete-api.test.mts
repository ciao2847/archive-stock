import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
const state = globalThis as typeof globalThis & {
  bulkDeleteRole: "staff" | "admin" | null;
  bulkDeleteCalls: unknown[];
  bulkDeleteResult: {
    data: { deletedProductIds: string[]; imagePaths: string[] } | null;
    error: { code?: string; message: string } | null;
  };
  bulkStorageCalls: string[][];
  bulkStorageError: boolean;
  bulkStorageThrows: boolean;
};
const result = await build({
  entryPoints: ["src/app/api/products/batch-delete/route.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  plugins: [
    {
      name: "auth",
      setup(builder) {
        builder.onResolve({ filter: /api\/server-auth$/ }, () => ({
          path: "auth",
          namespace: "fixture",
        }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: `
export const apiSuccess=(data,status=200)=>Response.json({success:true,data},{status});export const apiFailure=(error,status)=>Response.json({success:false,error},{status});export const withApiErrorHandling=async(_,handler)=>handler();
export const requireApiUser=async(roles=['admin','staff'])=>{const role=globalThis.bulkDeleteRole;if(!role)return{ok:false,response:apiFailure('login',401)};if(!roles.includes(role))return{ok:false,response:apiFailure('denied',403)};return{ok:true,role,supabase:{rpc:async(name,args)=>{globalThis.bulkDeleteCalls.push({name,args});return globalThis.bulkDeleteResult},storage:{from:()=>({remove:async(paths)=>{globalThis.bulkStorageCalls.push(paths);if(globalThis.bulkStorageThrows)throw new Error('storage unavailable');return{error:globalThis.bulkStorageError?{message:'storage denied'}:null}}})}}}};`,
        }));
      },
    },
  ],
});
const { POST } = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
);
const ids = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
];
function fixture() {
  state.bulkDeleteRole = "staff";
  state.bulkDeleteCalls = [];
  state.bulkStorageCalls = [];
  state.bulkStorageError = false;
  state.bulkStorageThrows = false;
  state.bulkDeleteResult = {
    data: { deletedProductIds: ids, imagePaths: ["main.webp", "thumb.webp"] },
    error: null,
  };
}
const request = (
  body: unknown = { productIds: ids },
  headers: Record<string, string> = {},
) =>
  new Request("https://example.com/api/products/batch-delete", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
test("bulk deletion rejects anonymous, cross-site, empty, duplicate and oversized batches before any writes", async () => {
  fixture();
  state.bulkDeleteRole = null;
  assert.equal((await POST(request())).status, 401);
  fixture();
  assert.equal(
    (await POST(request(undefined, { origin: "https://evil.example" }))).status,
    403,
  );
  assert.equal(
    (await POST(request(undefined, { "sec-fetch-site": "cross-site" }))).status,
    403,
  );
  for (const productIds of [
    [],
    [ids[0], ids[0]],
    Array(51).fill(ids[0]),
    ["A000038"],
    [null],
  ])
    assert.equal((await POST(request({ productIds }))).status, 400);
  assert.equal(state.bulkDeleteCalls.length, 0);
  assert.equal(state.bulkStorageCalls.length, 0);
});
test("staff and admins use one atomic RPC; image cleanup starts only after confirmed deletion", async () => {
  for (const role of ["staff", "admin"] as const) {
    fixture();
    state.bulkDeleteRole = role;
    const response = await POST(request());
    assert.equal(response.status, 200);
    assert.deepEqual(state.bulkDeleteCalls, [
      { name: "delete_inventory_products", args: { p_product_ids: ids } },
    ]);
    assert.deepEqual(state.bulkStorageCalls, [["main.webp", "thumb.webp"]]);
    assert.deepEqual((await response.json()).data.deletedProductIds, ids);
  }
});
test("failed or uncertain batch results never trigger image cleanup or falsely claim success", async () => {
  for (const [error, status] of [
    [{ code: "P0001", message: "product not found" }, 404],
    [{ code: "42501", message: "denied" }, 403],
    [{ code: "P0001", message: "fixture failure" }, 400],
    [{ code: "", message: "fetch failed" }, 503],
  ] as const) {
    fixture();
    state.bulkDeleteResult = { data: null, error };
    const response = await POST(request());
    assert.equal(response.status, status);
    assert.equal((await response.json()).success, false);
    assert.equal(state.bulkStorageCalls.length, 0);
  }
  fixture();
  assert.ok(state.bulkDeleteResult.data);
  state.bulkDeleteResult.data.deletedProductIds = [ids[0]];
  assert.equal((await POST(request())).status, 503);
  assert.equal(state.bulkStorageCalls.length, 0);
});
test("image cleanup errors report a warning while preserving the successful deletion result", async () => {
  for (const throws of [false, true]) {
    fixture();
    state.bulkStorageError = true;
    state.bulkStorageThrows = throws;
    const response = await POST(request());
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.match(result.data.imageCleanupWarning, /商品已刪除/);
    assert.deepEqual(result.data.deletedProductIds, ids);
  }
});
