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
      in?: [string, string[]];
      update?: Record<string, unknown>;
    }>;
    products: Array<{ id: string; owner_id: string }>;
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
const secondProductId = "00000000-0000-4000-8000-000000000003";
const foreignProductId = "00000000-0000-4000-8000-000000000004";
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
    in(key,values){filters.push([key,values]);s.calls.push({table,in:[key,values]});return this},
    then(resolve){return Promise.resolve({data:s.products.filter(product=>filters.every(([key,value])=>Array.isArray(value)?value.includes(product[key]):product[key]===value)),error:s.productError}).then(resolve)},
    async not(key,operator,value){s.calls.push({table,not:[key,operator,value]});
      if(s.updateError)return{count:null,error:s.updateError};
      const labels=s.labels.filter(label=>filters.every(([key,value])=>Array.isArray(value)?value.includes(label[key]):label[key]===value)&&label[key]!==value);
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
    products: [
      { id: productId, owner_id: inventoryId },
      { id: secondProductId, owner_id: inventoryId },
      { id: foreignProductId, owner_id: "other-inventory" },
    ],
    productError: null,
    updateError: null,
    labels: [
      { ...label },
      { ...label, status: "used", used_order_id: "order" },
      { ...label, status: "void" },
      { ...label, product_id: "other-product" },
      { ...label, printed_at: null },
      { ...label, used_order_id: "order" },
      { ...label, product_id: secondProductId },
    ],
  };
}
const request = (
  body: unknown = { inventoryId, productIds: [productId, secondProductId] },
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
    { inventoryId, productIds: [] },
    { inventoryId: "bad", productIds: [productId] },
    { inventoryId, productIds: [productId, productId] },
    { inventoryId, productIds: ["A000038"] },
    { inventoryId, productIds: Array(501).fill(productId) },
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
  const response = await POST(request());
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, {
    resetCount: 2,
    productCount: 2,
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
        JSON.stringify(call.in) ===
          JSON.stringify(["id", [productId, secondProductId]]),
    ),
  );
  assert.equal(state.printReset.labels[0].printed_at, null);
  assert.equal(state.printReset.labels[0].printed_by, null);
  assert.deepEqual(state.printReset.labels.slice(1, 6), before.slice(1, 6));
  assert.equal(state.printReset.labels[6].printed_at, null);
  assert.equal(state.printReset.calls.filter((call) => call.update).length, 1);
  assert.equal((await (await POST(request())).json()).data.resetCount, 0);
});

test("missing products and database errors are reported without a false success", async () => {
  fixture();
  state.printReset.products = [];
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

test("a mixed batch containing another inventory or a missing product performs no writes", async () => {
  for (const id of [foreignProductId, "00000000-0000-4000-8000-000000000099"]) {
    fixture();
    const before = structuredClone(state.printReset.labels);
    assert.equal(
      (await POST(request({ inventoryId, productIds: [productId, id] })))
        .status,
      404,
    );
    assert.equal(
      state.printReset.calls.some((call) => call.update),
      false,
    );
    assert.deepEqual(state.printReset.labels, before);
  }
});
