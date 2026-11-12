import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
const uid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const state = globalThis as typeof globalThis & {
  fifoRole: "staff" | "admin" | null;
  fifoCalls: Array<{ name: string; args: unknown }>;
  fifoError: string | null;
};
const built = await build({
  entryPoints: ["src/app/api/inventory-costs/route.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  plugins: [
    {
      name: "auth-fixture",
      setup(builder) {
        builder.onResolve({ filter: /api\/server-auth$/ }, () => ({
          path: "auth",
          namespace: "fixture",
        }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: `export const apiSuccess=(data,status=200)=>Response.json({success:true,data},{status});export const apiFailure=(error,status)=>Response.json({success:false,error},{status});export const withApiErrorHandling=async(_,handler)=>handler();export const requireApiUser=async()=>globalThis.fifoRole?{ok:true,role:globalThis.fifoRole,inventoryOwnerId:'${uid(1)}',supabase:{rpc:async(name,args)=>{globalThis.fifoCalls.push({name,args});return {data:{mode:'product_fifo',batches:[]},error:globalThis.fifoError?{message:globalThis.fifoError}:null};}}}:{ok:false,response:apiFailure('login',401)};`,
        }));
      },
    },
  ],
});
const cjs = { exports: {} };
new Function("require", "module", "exports", built.outputFiles[0].text)(
  createRequire(import.meta.url),
  cjs,
  cjs.exports,
);
const api = cjs.exports as {
  GET: (r: Request) => Promise<Response>;
  PUT: (r: Request) => Promise<Response>;
  PATCH: (r: Request) => Promise<Response>;
};
const request = (method: string, body: unknown) =>
  new Request("https://example.com/api/inventory-costs", {
    method,
    body: JSON.stringify(body),
  });
const cost = {
  batchId: uid(2),
  unitCost: 180,
  notes: "進貨",
  expectedRevision: 1,
};
function reset() {
  state.fifoRole = "staff";
  state.fifoCalls = [];
  state.fifoError = null;
}
test("batch API validates money and revisions before RPC and allows an explicit zero cost", async () => {
  reset();
  for (const value of [
    { ...cost, unitCost: -1 },
    { ...cost, unitCost: 0.001 },
    { ...cost, unitCost: null },
    { ...cost, expectedRevision: 0 },
    { ...cost, ownerId: uid(9) },
  ])
    assert.equal((await api.PATCH(request("PATCH", value))).status, 400);
  assert.equal(state.fifoCalls.length, 0);
  assert.equal(
    (await api.PATCH(request("PATCH", { ...cost, unitCost: 0 }))).status,
    200,
  );
  assert.deepEqual(state.fifoCalls[0], {
    name: "save_inventory_batch_cost",
    args: {
      p_batch_id: uid(2),
      p_unit_cost: 0,
      p_notes: "進貨",
      p_expected_revision: 1,
    },
  });
});
test("mode API blocks cross-inventory staff requests and anonymous reads and writes", async () => {
  reset();
  assert.equal(
    (await api.PUT(request("PUT", { ownerId: uid(9), mode: "product_fifo" })))
      .status,
    403,
  );
  assert.equal(state.fifoCalls.length, 0);
  assert.equal(
    (await api.PUT(request("PUT", { ownerId: uid(1), mode: "product_fifo" })))
      .status,
    200,
  );
  state.fifoRole = null;
  assert.equal(
    (
      await api.GET(
        new Request(
          `https://example.com/api/inventory-costs?productId=${uid(2)}`,
        ),
      )
    ).status,
    401,
  );
  assert.equal((await api.PATCH(request("PATCH", cost))).status, 401);
  assert.equal(
    (await api.PUT(request("PUT", { ownerId: uid(1), mode: "product_fifo" })))
      .status,
    401,
  );
});
test("cost authorization, concurrent edits and settled batches return actionable errors", async () => {
  reset();
  state.fifoError = "owner access required";
  assert.equal(
    (
      await api.GET(
        new Request(
          `https://example.com/api/inventory-costs?productId=${uid(9)}`,
        ),
      )
    ).status,
    403,
  );
  for (const error of [
    "cost batch changed; reload",
    "settled batch cost is locked",
  ]) {
    state.fifoError = error;
    const result = await api.PATCH(request("PATCH", cost));
    assert.equal(result.status, 409);
    assert.ok((await result.json()).error);
  }
});
