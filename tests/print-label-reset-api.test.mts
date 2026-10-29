import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const state = globalThis as typeof globalThis & {
  printReset: {
    role: "admin" | "staff" | null;
    calls: Array<{
      table: string;
      select?: string;
      eq?: [string, unknown];
      update?: Record<string, unknown>;
    }>;
    product: { id: string; sku: string; name: string } | null;
    productError: unknown;
    updateError: unknown;
    labels: Array<{
      product_id: string;
      status: string;
      used_order_id: string | null;
      printed_at: string | null;
      printed_by: string | null;
    }>;
  };
};
const productId = "00000000-0000-4000-8000-000000000001";
const inventoryId = "00000000-0000-4000-8000-000000000002";
const bundle = await build({
  entryPoints: ["src/app/api/print-labels/reset/route.ts"],
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
export const apiSuccess=data=>Response.json({success:true,data});
export const apiFailure=(error,status)=>Response.json({success:false,error},{status});
export const withApiErrorHandling=async(_,handler)=>handler();
export async function requireApiUser(roles){
 const s=globalThis.printReset;
 if(!s.role)return{ok:false,response:apiFailure('login',401)};
 if(!roles.includes(s.role))return{ok:false,response:apiFailure('denied',403)};
 return{ok:true,role:s.role,supabase:{from(table){
   const filters=[];let patch;
   const query={select(fields){s.calls.push({table,select:fields});return this},
    eq(key,value){filters.push([key,value]);s.calls.push({table,eq:[key,value]});return this},
    is(key,value){filters.push([key,value]);s.calls.push({table,is:[key,value]});return this},
    update(values,options){patch=values;s.calls.push({table,update:values,options});return this},
    async maybeSingle(){return{data:s.product,error:s.productError}},
    async not(key,operator,value){s.calls.push({table,not:[key,operator,value]});
      if(s.updateError)return{count:null,error:s.updateError};
      const labels=s.labels.filter(label=>filters.every(([key,value])=>label[key]===value)&&label[key]!==value);
      for(const label of labels)Object.assign(label,patch);
      return{count:labels.length,error:null};
    }};return query;
 }}};
}`,
        }));
      },
    },
  ],
});
const { POST } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
function fixture() {
  const label = {
    product_id: productId,
    status: "active",
    used_order_id: null,
    printed_at: "2026-10-29T00:00:00Z",
    printed_by: inventoryId,
  };
  state.printReset = {
    role: "admin",
    calls: [],
    product: { id: productId, sku: "A000038", name: "測試海報" },
    productError: null,
    updateError: null,
    labels: [
      { ...label },
      { ...label, status: "used", used_order_id: "order" },
      { ...label, status: "void" },
      { ...label, product_id: "other-product" },
      { ...label, printed_at: null },
      { ...label, used_order_id: "order" },
    ],
  };
}
const request = (
  body: unknown = { inventoryId, sku: "A000038" },
  headers = {},
) =>
  new Request("https://example.com/api/print-labels/reset", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

test("only admins can reset labels; rejects invalid and cross-site requests before queries", async () => {
  for (const [role, status] of [
    [null, 401],
    ["staff", 403],
  ] as const) {
    fixture();
    state.printReset.role = role;
    assert.equal((await POST(request())).status, status);
    assert.deepEqual(state.printReset.calls, []);
  }
  fixture();
  for (const body of [
    { inventoryId, sku: " " },
    { inventoryId: "bad", sku: "A000038" },
    {},
  ])
    assert.equal((await POST(request(body))).status, 400);
  assert.equal(
    (await POST(request(undefined, { origin: "https://evil.example" }))).status,
    403,
  );
  assert.equal(
    (await POST(request(undefined, { "sec-fetch-site": "cross-site" }))).status,
    403,
  );
  assert.deepEqual(state.printReset.calls, []);
});

test("reset is scoped to inventory and product, preserves used/void/other labels, and is repeatable", async () => {
  fixture();
  const before = structuredClone(state.printReset.labels);
  const response = await POST(request({ inventoryId, sku: " A000038 " }));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, {
    resetCount: 1,
    sku: "A000038",
    productName: "測試海報",
  });
  assert.ok(
    state.printReset.calls.some(
      (call) =>
        call.table === "products" &&
        JSON.stringify(call.eq) === JSON.stringify(["owner_id", inventoryId]),
    ),
  );
  assert.ok(
    state.printReset.calls.some(
      (call) =>
        call.table === "products" &&
        JSON.stringify(call.eq) === JSON.stringify(["sku", "A000038"]),
    ),
  );
  assert.equal(state.printReset.labels[0].printed_at, null);
  assert.equal(state.printReset.labels[0].printed_by, null);
  assert.deepEqual(state.printReset.labels.slice(1), before.slice(1));
  assert.equal((await (await POST(request())).json()).data.resetCount, 0);
});

test("missing products and database errors are reported without a false success", async () => {
  fixture();
  state.printReset.product = null;
  assert.equal((await POST(request())).status, 404);
  assert.equal(
    state.printReset.calls.some((call) => call.update),
    false,
  );
  fixture();
  state.printReset.productError = { message: "unavailable" };
  assert.equal((await POST(request())).status, 503);
  assert.equal(
    state.printReset.calls.some((call) => call.update),
    false,
  );
  fixture();
  state.printReset.updateError = { message: "denied" };
  assert.equal((await POST(request())).status, 503);
});
