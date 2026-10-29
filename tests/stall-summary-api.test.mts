import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
const bundle = await build({
  entryPoints: ["src/app/api/checkout/summary/route.ts"],
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
          contents: `export const requireApiUser=async()=>globalThis.stallSummaryAuth;export const apiSuccess=data=>Response.json({success:true,data});export const apiFailure=(error,status)=>Response.json({success:false,error},{status});`,
        }));
      },
    },
  ],
});
const { GET } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const ownerId = "00000000-0000-4000-8000-000000000001";
const authGlobal = globalThis as typeof globalThis & {
  stallSummaryAuth: unknown;
};
test("daily sales API scopes paid delivered stall orders to the inventory and pages all results", async () => {
  const calls: Array<Array<[string, ...unknown[]]>> = [];
  let page = 0;
  authGlobal.stallSummaryAuth = {
    ok: true,
    role: "staff",
    inventoryOwnerId: ownerId,
    supabase: {
      from(table: string) {
        assert.equal(table, "orders");
        const filters: Array<[string, ...unknown[]]> = [];
        calls.push(filters);
        const query: Record<string, unknown> = {};
        for (const method of [
          "select",
          "eq",
          "in",
          "is",
          "gte",
          "lt",
          "order",
          "limit",
          "gt",
        ]) {
          query[method] = (...args: unknown[]) => {
            filters.push([method, ...args]);
            return query;
          };
        }
        query.then = (resolve: (x: unknown) => void) =>
          resolve({
            data:
              page++ === 0
                ? Array.from({ length: 501 }, (_, i) => ({
                    id: String(i).padStart(5, "0"),
                    order_items: [{ quantity: 2, unit_price: 350 }],
                  }))
                : [],
            error: null,
          });
        return query;
      },
    },
  };
  const response = await GET(
    new Request(`https://example.com/api/checkout/summary?ownerId=${ownerId}`),
  );
  const result = await response.json();
  assert.equal(result.data.orderCount, 501);
  assert.equal(result.data.itemCount, 1002);
  assert.equal(result.data.revenue, 350700);
  assert.ok(
    calls[0].some(
      (x) => x[0] === "eq" && x[1] === "owner_id" && x[2] === ownerId,
    ),
  );
  assert.ok(
    calls[0].some(
      (x) => x[0] === "eq" && x[1] === "notes" && x[2] === "攤位掃碼結帳",
    ),
  );
  assert.ok(
    calls[0].some(
      (x) => x[0] === "eq" && x[1] === "payment_status" && x[2] === "paid",
    ),
  );
  assert.ok(
    calls[0].some(
      (x) => x[0] === "is" && x[1] === "deleted_at" && x[2] === null,
    ),
  );
  assert.ok(
    calls[0].some(
      (x) =>
        x[0] === "in" &&
        x[1] === "status" &&
        JSON.stringify(x[2]) === '["packed","shipped"]',
    ),
  );
  const start = calls[0].find((x) => x[0] === "gte")?.[2] as string;
  const end = calls[0].find((x) => x[0] === "lt")?.[2] as string;
  assert.equal(new Date(end).getTime() - new Date(start).getTime(), 86400000);
  assert.ok(start.endsWith("T16:00:00.000Z"));
  assert.ok(
    calls[1].some((x) => x[0] === "gt" && x[1] === "id" && x[2] === "00500"),
  );
});
test("staff cannot read another inventory's daily revenue", async () => {
  authGlobal.stallSummaryAuth = {
    ok: true,
    role: "staff",
    inventoryOwnerId: "other",
    supabase: {
      from() {
        throw new Error("Query must not run");
      },
    },
  };
  assert.equal(
    (
      await GET(
        new Request(
          `https://example.com/api/checkout/summary?ownerId=${ownerId}`,
        ),
      )
    ).status,
    403,
  );
});
