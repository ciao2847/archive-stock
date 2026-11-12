import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
const uid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const state = globalThis as typeof globalThis & {
  posterCostRole: "staff" | "admin" | null;
  posterCostError: string | null;
  posterCostCalls: Array<{ name: string; args: Record<string, unknown> }>;
};
const built = await build({
  entryPoints: [
    "src/app/api/products/route.ts",
    "src/app/api/products/[id]/route.ts",
  ],
  outbase: "src",
  outdir: "/tmp/poster-unit-cost-api",
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  plugins: [
    {
      name: "fixtures",
      setup(builder) {
        builder.onResolve({ filter: /api\/server-auth$/ }, () => ({
          path: "auth",
          namespace: "fixture",
        }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: `export const apiSuccess=(data,status=200)=>Response.json({success:true,data},{status});export const apiFailure=(error,status)=>Response.json({success:false,error},{status});export const withApiErrorHandling=async(_,handler)=>handler();export const requireApiUser=async()=>globalThis.posterCostRole?{ok:true,role:globalThis.posterCostRole,inventoryOwnerId:'${uid(1)}',supabase:{rpc:async(name,args)=>{globalThis.posterCostCalls.push({name,args});return{data:'${uid(10)}',error:globalThis.posterCostError?{message:globalThis.posterCostError}:null};}}}:{ok:false,response:apiFailure('login',401)};`,
        }));
        builder.onResolve({ filter: /^server-only$/ }, () => ({
          path: "empty",
          namespace: "empty",
        }));
        builder.onLoad({ filter: /.*/, namespace: "empty" }, () => ({
          contents: "",
        }));
      },
    },
  ],
});
function load(suffix: string) {
  const cjs = { exports: {} };
  new Function(
    "require",
    "module",
    "exports",
    built.outputFiles.find((f) => f.path.endsWith(suffix))!.text,
  )(createRequire(import.meta.url), cjs, cjs.exports);
  return cjs.exports as {
    POST: (r: Request) => Promise<Response>;
    PATCH: (
      r: Request,
      context: { params: Promise<{ id: string }> },
    ) => Promise<Response>;
  };
}
const create = load("api/products/route.js");
const edit = load("api/products/[id]/route.js");
const input = {
  ownerId: uid(1),
  name: "海報",
  category: "海報",
  country: "韓國",
  source: "",
  location: "",
  stock: 10,
  price: 300,
  format: "",
  size: "A3",
  crafts: [],
  imagePaths: ["poster.webp"],
  feature: "",
  description: "",
  unitCost: 180,
};
const request = (method: string, body: unknown) =>
  new Request("https://example.com/api/products", {
    method,
    body: JSON.stringify(body),
  });
const context = { params: Promise.resolve({ id: uid(10) }) };
function reset() {
  state.posterCostRole = "staff";
  state.posterCostError = null;
  state.posterCostCalls = [];
}
test("poster create/edit with costs use one atomic RPC and pass the explicit batch revision", async () => {
  reset();
  assert.equal((await create.POST(request("POST", input))).status, 201);
  assert.equal(
    state.posterCostCalls[0].name,
    "save_inventory_product_with_cost",
  );
  assert.equal(
    (state.posterCostCalls[0].args.p_input as typeof input).unitCost,
    180,
  );
  const updated = {
    ...input,
    unitCost: 0,
    costBatchId: uid(20),
    expectedCostRevision: 2,
  };
  assert.equal(
    (await edit.PATCH(request("PATCH", updated), context)).status,
    200,
  );
  const call = state.posterCostCalls[1];
  assert.equal(call.name, "save_inventory_product_with_cost");
  assert.equal(call.args.p_product_id, uid(10));
  assert.equal((call.args.p_input as typeof updated).expectedCostRevision, 2);
});
test("invalid and cross-inventory costs never reach the product write RPC", async () => {
  reset();
  for (const unitCost of [-1, 0.001, null])
    assert.equal(
      (await create.POST(request("POST", { ...input, unitCost }))).status,
      400,
    );
  assert.equal(
    (await create.POST(request("POST", { ...input, ownerId: uid(9) }))).status,
    403,
  );
  assert.equal(
    (
      await edit.PATCH(
        request("PATCH", { ...input, costBatchId: uid(20) }),
        context,
      )
    ).status,
    400,
  );
  assert.equal(state.posterCostCalls.length, 0);
  state.posterCostRole = null;
  assert.equal((await create.POST(request("POST", input))).status, 401);
});
test("manual accounting retains the existing product RPC, and stale costs produce a clear conflict", async () => {
  reset();
  const { unitCost, ...ordinary } = input;
  assert.equal(unitCost, 180);
  assert.equal((await create.POST(request("POST", ordinary))).status, 201);
  assert.equal(state.posterCostCalls[0].name, "create_inventory_product");
  state.posterCostError = "cost batch changed; reload";
  const response = await edit.PATCH(
    request("PATCH", {
      ...input,
      costBatchId: uid(20),
      expectedCostRevision: 1,
    }),
    context,
  );
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /成本已被更新/);
});
