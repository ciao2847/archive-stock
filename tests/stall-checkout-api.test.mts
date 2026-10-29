import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
const bundle = await build({
  entryPoints: ["src/app/api/checkout/route.ts"],
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
          contents: `export const requireApiUser=async(roles)=>{globalThis.checkoutRoles=roles;return globalThis.checkoutAuth};export const apiSuccess=data=>Response.json({success:true,data});export const apiFailure=(error,status)=>Response.json({success:false,error},{status});`,
        }));
      },
    },
  ],
});
const { GET, POST } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const ownerId = "00000000-0000-4000-8000-000000000001";
const otherOwnerId = "00000000-0000-4000-8000-000000000002";
const token = "00000000-0000-4000-8000-000000000003";
const globals = globalThis as typeof globalThis & {
  checkoutAuth: unknown;
  checkoutRoles: unknown;
};
function request(owner: string) {
  return new Request("https://example.com/api/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ownerId: owner,
      tokens: [token],
      expectedTotal: 350,
    }),
  });
}
test("staff can complete checkout in their own inventory", async () => {
  globals.checkoutAuth = {
    ok: true,
    role: "staff",
    inventoryOwnerId: ownerId,
    supabase: {
      async rpc(name: string, args: unknown) {
        assert.equal(name, "checkout_stall_labels");
        assert.deepEqual(args, {
          p_owner_id: ownerId,
          p_tokens: [token],
          p_expected_total: 350,
        });
        return { data: { orderId: "sale", total: 350 }, error: null };
      },
    },
  };
  const response = await POST(request(ownerId));
  assert.equal(response.status, 200);
  assert.deepEqual(globals.checkoutRoles, ["admin", "staff"]);
  assert.equal((await response.json()).data.total, 350);
});
test("staff cannot scan or checkout another inventory", async () => {
  globals.checkoutAuth = {
    ok: true,
    role: "staff",
    inventoryOwnerId: ownerId,
    supabase: {
      rpc() {
        throw new Error("must not access database");
      },
      from() {
        throw new Error("must not access database");
      },
    },
  };
  assert.equal((await POST(request(otherOwnerId))).status, 403);
  assert.equal(
    (
      await GET(
        new Request(
          `https://example.com/api/checkout?ownerId=${otherOwnerId}&value=${token}`,
        ),
      )
    ).status,
    403,
  );
});
test("unauthenticated callers cannot scan or checkout", async () => {
  globals.checkoutAuth = {
    ok: false,
    response: Response.json({ error: "請先登入" }, { status: 401 }),
  };
  assert.equal((await POST(request(ownerId))).status, 401);
  assert.equal(
    (
      await GET(
        new Request(
          `https://example.com/api/checkout?ownerId=${ownerId}&value=${token}`,
        ),
      )
    ).status,
    401,
  );
});

function lookupFixture({
  stock = 2,
  status = "in_stock",
  missing = false,
  labels = [token, "00000000-0000-4000-8000-000000000004"],
} = {}) {
  const calls: Array<{ table: string; filters: Array<[string, unknown]> }> = [];
  globals.checkoutAuth = {
    ok: true,
    role: "staff",
    inventoryOwnerId: ownerId,
    supabase: {
      from(table: string) {
        const call = { table, filters: [] as Array<[string, unknown]> };
        calls.push(call);
        const query = {
          select() {
            return query;
          },
          eq(column: string, value: unknown) {
            call.filters.push([column, value]);
            return query;
          },
          order() {
            return query;
          },
          async limit(size: number) {
            assert.equal(size, 101);
            return { data: labels.map((token) => ({ token })), error: null };
          },
          async maybeSingle() {
            return {
              data: missing
                ? null
                : table === "products"
                  ? {
                      id: "product-1",
                      owner_id: ownerId,
                      sku: "A000038",
                      name: "測試海報",
                      price: 200,
                      stock,
                      status,
                    }
                  : { token, product_id: "product-1", status: "active" },
              error: null,
            };
          },
        };
        return query;
      },
    },
  };
  return calls;
}

function lookup(value: string, excluded: string[] = [], owner = ownerId) {
  const params = new URLSearchParams({ ownerId: owner, value });
  excluded.forEach((token) => params.append("excludeToken", token));
  return GET(new Request(`https://example.com/api/checkout?${params}`));
}

test("manual SKU lookup accepts lowercase, scopes to the inventory and picks a different active unit", async () => {
  const calls = lookupFixture();
  const response = await lookup("  a000038  ", [token]);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, {
    token: "00000000-0000-4000-8000-000000000004",
    productId: "product-1",
    sku: "A000038",
    name: "測試海報",
    listPrice: 350,
    stock: 2,
  });
  assert.deepEqual(calls[0], {
    table: "products",
    filters: [
      ["sku", "A000038"],
      ["owner_id", ownerId],
    ],
  });
  assert.deepEqual(calls[1], {
    table: "product_qr_labels",
    filters: [
      ["product_id", "product-1"],
      ["status", "active"],
    ],
  });
});

test("manual entry rejects other inventories, invalid codes, sold-out products and exhausted labels", async () => {
  let calls = lookupFixture();
  assert.equal((await lookup("A000038", [], otherOwnerId)).status, 403);
  assert.equal((await lookup("A000038", ["invalid-token"])).status, 400);
  assert.equal((await lookup("A38")).status, 400);
  assert.equal(calls.length, 0);
  lookupFixture({ missing: true });
  assert.equal((await lookup("A000038")).status, 404);
  calls = lookupFixture({ stock: 0 });
  assert.equal((await lookup("A000038")).status, 409);
  assert.equal(calls.length, 1);
  lookupFixture({ status: "reserved" });
  assert.equal((await lookup("A000038")).status, 409);
  lookupFixture({ labels: [token] });
  assert.equal((await lookup("A000038", [token])).status, 409);
});

test("QR URL and legacy content continue to resolve the scanned unit", async () => {
  for (const raw of [`https://example.com/qr/${token}`, `AS1:${token}`]) {
    const calls = lookupFixture();
    const response = await lookup(raw);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.token, token);
    assert.deepEqual(calls[0], {
      table: "product_qr_labels",
      filters: [["token", token]],
    });
    assert.ok(
      calls[1].filters.some(
        ([key, value]) => key === "owner_id" && value === ownerId,
      ),
    );
  }
});
