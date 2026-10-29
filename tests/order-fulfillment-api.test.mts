import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
const globals = globalThis as typeof globalThis & { fulfillmentAuth: unknown };
const bundle = await build({
  entryPoints: ["src/app/api/order-fulfillment/route.ts"],
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
          contents: `export const requireApiUser=async()=>globalThis.fulfillmentAuth;export const apiSuccess=data=>Response.json({success:true,data});export const apiFailure=(error,status)=>Response.json({success:false,error},{status});export const withApiErrorHandling=async(_,handler)=>handler();`,
        }));
      },
    },
  ],
});
const { GET, POST } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const ownerId = "00000000-0000-4000-8000-000000000001";
const productId = "00000000-0000-4000-8000-000000000031";
function request(body: unknown) {
  return new Request("https://example.com/api/order-fulfillment", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
const input = {
  ownerId,
  bundleOrderId: 9,
  items: [{ productId, quantity: 2, unitPrice: 300 }],
};
test("bundle mapping authenticates, validates inventory and forwards exact source and prices", async () => {
  globals.fulfillmentAuth = {
    ok: false,
    response: Response.json({}, { status: 401 }),
  };
  assert.equal((await POST(request(input))).status, 401);
  let called = false;
  globals.fulfillmentAuth = {
    ok: true,
    role: "staff",
    inventoryOwnerId: ownerId,
    supabase: {
      async rpc(name: string, args: unknown) {
        called = true;
        assert.equal(name, "map_bundle_fulfillment");
        assert.deepEqual(args, {
          p_owner_id: ownerId,
          p_order_id: 9,
          p_items: [{ product_id: productId, quantity: 2, unit_price: 300 }],
        });
        return { data: productId, error: null };
      },
    },
  };
  assert.equal(
    (
      await POST(
        request({ ...input, ownerId: "00000000-0000-4000-8000-000000000002" }),
      )
    ).status,
    403,
  );
  assert.equal(called, false);
  assert.equal(
    (
      await POST(
        request({
          ...input,
          items: [{ productId, quantity: 1.5, unitPrice: 300 }],
        }),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await POST(
        request({
          ...input,
          items: [{ productId, quantity: 1, unitPrice: 1.111 }],
        }),
      )
    ).status,
    400,
  );
  assert.equal(called, false);
  assert.equal((await POST(request(input))).status, 200);
  assert.equal(called, true);
});
test("mapping returns actionable errors for a locked order and an unapplied local migration", async () => {
  globals.fulfillmentAuth = {
    ok: true,
    role: "staff",
    inventoryOwnerId: ownerId,
    supabase: {
      async rpc() {
        return {
          data: null,
          error: { message: "fulfillment already started" },
        };
      },
    },
  };
  let response = await POST(request(input));
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /已開始掃描/);
  globals.fulfillmentAuth = {
    ok: true,
    role: "staff",
    inventoryOwnerId: ownerId,
    supabase: {
      async rpc() {
        return { data: null, error: { code: "PGRST202", message: "missing" } };
      },
    },
  };
  response = await POST(request(input));
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /尚未安裝/);
});

test("fulfillment diagnostics distinguish unavailable schema, missing order and missing products", async () => {
  let result: { data: unknown; error: unknown } = {
    data: null,
    error: { code: "42703" },
  };
  globals.fulfillmentAuth = {
    ok: true,
    role: "staff",
    inventoryOwnerId: ownerId,
    supabase: {
      from() {
        const query = {
          select() {
            return query;
          },
          eq() {
            return query;
          },
          is() {
            return query;
          },
          async maybeSingle() {
            return result;
          },
        };
        return query;
      },
    },
  };
  const request = () =>
    new Request(
      `https://example.com/api/order-fulfillment?ownerId=${ownerId}&source=claim&submissionId=1`,
    );
  assert.equal((await (await GET(request())).json()).data.state, "unavailable");
  result = { data: null, error: null };
  assert.equal(
    (await (await GET(request())).json()).data.state,
    "missing_order",
  );
  result = { data: { id: productId, order_items: [] }, error: null };
  assert.equal(
    (await (await GET(request())).json()).data.state,
    "missing_products",
  );
  result = {
    data: { id: productId, order_items: [{ id: productId }] },
    error: null,
  };
  assert.equal((await (await GET(request())).json()).data.state, "ready");
  result = { data: null, error: { code: "42501" } };
  assert.equal((await GET(request())).status, 503);
  assert.equal(
    (
      await GET(
        new Request(
          `https://example.com/api/order-fulfillment?ownerId=00000000-0000-4000-8000-000000000002&source=claim&submissionId=1`,
        ),
      )
    ).status,
    403,
  );
});
