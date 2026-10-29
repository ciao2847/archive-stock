import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import {
  stallOrderEditSchema,
  stallOrderSearchSchema,
} from "../src/lib/stall-orders.ts";

const owner = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const id = "00000000-0000-4000-8000-000000000003";
const globals = globalThis as typeof globalThis & {
  stallAuth: unknown;
  stallCalls: Array<[string, unknown]>;
  stallRpcError: unknown;
};
async function load(path: string) {
  const result = await build({
    entryPoints: [path],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    plugins: [
      {
        name: "stall-auth",
        setup(builder) {
          builder.onResolve({ filter: /api\/server-auth$/ }, () => ({
            path: "auth",
            namespace: "fixture",
          }));
          builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            contents: `export const requireApiUser=async()=>globalThis.stallAuth;export const apiSuccess=data=>Response.json({success:true,data});export const apiFailure=(error,status)=>Response.json({success:false,error},{status});export const withApiErrorHandling=(_name,fn)=>fn();`,
          }));
        },
      },
    ],
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
  );
}
const list = await load("src/app/api/checkout/orders/route.ts");
const detail = await load("src/app/api/checkout/orders/[id]/route.ts");
function auth() {
  globals.stallCalls = [];
  globals.stallRpcError = null;
  globals.stallAuth = {
    ok: true,
    role: "staff",
    inventoryOwnerId: owner,
    supabase: {
      async rpc(name: string, args: unknown) {
        globals.stallCalls.push([name, args]);
        return { data: { orders: [], total: 0 }, error: globals.stallRpcError };
      },
    },
  };
}
const context = { params: Promise.resolve({ id }) };
function request(method: string, body: unknown, site?: string) {
  return new Request(`https://example.com/api/checkout/orders/${id}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(site ? { "sec-fetch-site": site } : {}),
    },
    body: JSON.stringify(body),
  });
}
test("stall history validates dates, scopes staff searches and passes only validated filters", async () => {
  auth();
  assert.equal(
    (
      await list.GET(
        new Request(`https://example.com/api/checkout/orders?ownerId=${other}`),
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await list.GET(
        new Request(
          `https://example.com/api/checkout/orders?ownerId=${owner}&start=2026-02-30`,
        ),
      )
    ).status,
    400,
  );
  assert.equal(globals.stallCalls.length, 0);
  assert.equal(
    (
      await list.GET(
        new Request(
          `https://example.com/api/checkout/orders?ownerId=${owner}&query=A000038&status=cancelled&page=2`,
        ),
      )
    ).status,
    200,
  );
  assert.deepEqual(globals.stallCalls[0], [
    "find_stall_orders",
    { p_owner_id: owner, p_query: "A000038", p_status: "cancelled", p_page: 2 },
  ]);
});
test("inventory member edits use one atomic revision-checked operation, and cancellation keeps the same scope", async () => {
  auth();
  const body = {
    ownerId: owner,
    revision: 3,
    note: " correction ",
    items: [{ productId: id, quantity: 2, unitPrice: 350.25 }],
  };
  assert.equal(
    (await detail.PATCH(request("PATCH", body), context)).status,
    200,
  );
  assert.deepEqual(globals.stallCalls[0], [
    "manage_stall_order",
    {
      p_owner_id: owner,
      p_order_id: id,
      p_expected_revision: 3,
      p_action: "edit",
      p_note: "correction",
      p_items: [{ product_id: id, quantity: 2, unit_price: 350.25 }],
    },
  ]);
  assert.equal(
    (
      await detail.POST(
        request("POST", { ownerId: owner, revision: 4 }),
        context,
      )
    ).status,
    200,
  );
  assert.deepEqual(globals.stallCalls[1], [
    "manage_stall_order",
    {
      p_owner_id: owner,
      p_order_id: id,
      p_expected_revision: 4,
      p_action: "cancel",
    },
  ]);
  globals.stallRpcError = { message: "stall order changed", code: "P0001" };
  assert.equal(
    (
      await detail.POST(
        request("POST", { ownerId: owner, revision: 3 }),
        context,
      )
    ).status,
    409,
  );
});
test("anonymous, cross-inventory, cross-site and invalid edit requests never reach the database", async () => {
  auth();
  assert.equal(
    (
      await detail.POST(
        request("POST", { ownerId: other, revision: 0 }),
        context,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await detail.POST(
        request("POST", { ownerId: owner, revision: 0 }, "cross-site"),
        context,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await detail.PATCH(
        request("PATCH", { ownerId: owner, revision: 0, note: "", items: [] }),
        context,
      )
    ).status,
    400,
  );
  assert.equal(globals.stallCalls.length, 0);
  globals.stallAuth = {
    ok: false,
    response: Response.json({}, { status: 401 }),
  };
  assert.equal(
    (
      await list.GET(
        new Request(`https://example.com/api/checkout/orders?ownerId=${owner}`),
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await detail.POST(
        request("POST", { ownerId: owner, revision: 0 }),
        context,
      )
    ).status,
    401,
  );
});
test("stall edit validation rejects duplicate products, fractional units and more than two price decimals", () => {
  const item = { productId: id, quantity: 1, unitPrice: 300 };
  const base = { ownerId: owner, revision: 0, note: "", items: [item] };
  assert.equal(stallOrderEditSchema.safeParse(base).success, true);
  for (const items of [
    [item, item],
    [{ ...item, quantity: 1.5 }],
    [{ ...item, unitPrice: 1.234 }],
    [{ ...item, quantity: 101 }],
  ])
    assert.equal(
      stallOrderEditSchema.safeParse({ ...base, items }).success,
      false,
    );
  assert.equal(
    stallOrderSearchSchema.safeParse({
      ownerId: owner,
      start: "2026-10-16",
      end: "2026-10-15",
    }).success,
    false,
  );
});
