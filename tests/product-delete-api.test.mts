import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
const state = globalThis as typeof globalThis & {
  deletionRole: "staff" | "admin" | null;
  deletionCalls: Array<{ name: string; args: unknown }>;
  deletionRPCError: { code: string; message: string } | null;
  deletedImagePaths: string[];
};
const bundle = await build({
  entryPoints: ["src/app/api/products/[id]/route.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  plugins: [
    {
      name: "auth-fixture",
      setup(builder) {
        builder.onResolve({ filter: /api\/server-auth$/ }, () => ({
          path: "auth",
          namespace: "fixture",
        }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: `
 export const apiSuccess=(data,status=200)=>Response.json({success:true,data},{status});
 export const apiFailure=(error,status)=>Response.json({success:false,error},{status});
 export const requireApiUser=async(roles=['admin','staff'])=>{
 const role=globalThis.deletionRole;
 if(!role)return{ok:false,response:apiFailure('請先登入',401)};
 if(!roles.includes(role))return{ok:false,response:apiFailure('權限不足',403)};
 return{ok:true,role,inventoryOwnerId:'00000000-0000-4000-8000-000000000001',supabase:{rpc:async(name,args)=>{globalThis.deletionCalls.push({name,args});return{data:[],error:globalThis.deletionRPCError}},storage:{from:()=>({remove:async(paths)=>{globalThis.deletedImagePaths=paths;return{error:null}}})}}};};
 export const withApiErrorHandling=async(_,handler)=>handler();`,
        }));
      },
    },
  ],
});
const { DELETE } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const id = "00000000-0000-4000-8000-000000000002";
const request = () =>
  new Request("https://example.com/api/products/" + id, { method: "DELETE" });
const params = (value = id) => ({ params: Promise.resolve({ id: value }) });
function fixture() {
  state.deletionRole = "staff";
  state.deletionCalls = [];
  state.deletionRPCError = null;
  state.deletedImagePaths = [];
}
test("inventory staff and administrators both reach the inventory-scoped deletion RPC", async () => {
  for (const role of ["staff", "admin"] as const) {
    fixture();
    state.deletionRole = role;
    const response = await DELETE(request(), params());
    assert.equal(response.status, 200);
    assert.deepEqual(state.deletionCalls, [
      { name: "delete_inventory_product", args: { p_product_id: id } },
    ]);
    assert.equal((await response.json()).data.deleted, true);
  }
});
test("anonymous and malformed deletion requests never invoke a database mutation", async () => {
  fixture();
  state.deletionRole = null;
  assert.equal((await DELETE(request(), params())).status, 401);
  assert.equal(state.deletionCalls.length, 0);
  fixture();
  assert.equal((await DELETE(request(), params("A000038"))).status, 400);
  assert.equal(state.deletionCalls.length, 0);
});
test("cross-inventory, missing permissions and unavailable functions never report successful deletion", async () => {
  for (const [error, status] of [
    [{ code: "P0001", message: "product not found" }, 404],
    [{ code: "42501", message: "denied" }, 403],
    [{ code: "PGRST202", message: "missing" }, 503],
  ] as const) {
    fixture();
    state.deletionRPCError = error;
    const response = await DELETE(request(), params());
    assert.equal(response.status, status);
    assert.equal((await response.json()).success, false);
    assert.deepEqual(state.deletedImagePaths, []);
  }
});
