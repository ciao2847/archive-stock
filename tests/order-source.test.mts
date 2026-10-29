import assert from "node:assert/strict";
import test from "node:test";
import {
  getOrderSource,
  getOrdersPath,
  getOrderSourceFilter,
} from "../src/lib/order-source.ts";
import { build } from "esbuild";

test("order sources use the persisted stall marker and produce refreshable, encoded filter URLs", () => {
  assert.equal(getOrderSource("攤位掃碼結帳"), "stall");
  assert.equal(getOrderSource("一般私訊訂單"), "general");
  assert.equal(getOrderSource(null), "general");
  assert.equal(getOrdersPath("all"), "/orders");
  assert.equal(getOrdersPath("general"), "/orders?source=general");
  assert.equal(getOrdersPath("stall"), "/orders?source=stall");
  assert.equal(
    new URL(
      getOrdersPath("stall", "ORDER #1"),
      "https://example.com",
    ).searchParams.get("order"),
    "ORDER #1",
  );
  assert.equal(getOrderSourceFilter("unknown"), "all");
});

const globals = globalThis as typeof globalThis & {
  ordersAuth: unknown;
  ordersQueries: Array<{ cursor?: string }>;
};
const bundle = await build({
  entryPoints: ["src/app/api/orders/route.ts"],
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
          contents: `export const requireApiUser=async()=>globalThis.ordersAuth;export const apiSuccess=data=>Response.json({success:true,data});export const apiFailure=(error,status)=>Response.json({success:false,error},{status});`,
        }));
      },
    },
  ],
});
const { GET } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
test("unified order lookup reads all pages, classifies sources and omits private notes", async () => {
  globals.ordersQueries = [];
  const row = (index: number) => ({
    id: String(index).padStart(36, "0"),
    created_at: index === 500 ? "2026-10-16T00:00:00Z" : "2026-10-15T00:00:00Z",
    notes: index === 500 ? "攤位掃碼結帳" : "private notes",
    owner_id: "inventory",
  });
  globals.ordersAuth = {
    ok: true,
    supabase: {
      from(table: string) {
        assert.equal(table, "orders");
        const call = {} as { cursor?: string };
        globals.ordersQueries.push(call);
        const query = {
          select(value: string) {
            assert.match(value, /notes/);
            return query;
          },
          is(column: string, value: unknown) {
            assert.equal(column, "deleted_at");
            assert.equal(value, null);
            return query;
          },
          order(column: string) {
            assert.equal(column, "id");
            return query;
          },
          limit(size: number) {
            assert.equal(size, 500);
            return query;
          },
          gt(column: string, value: string) {
            assert.equal(column, "id");
            call.cursor = value;
            return query;
          },
          then(resolve: (value: unknown) => void) {
            resolve({
              data: call.cursor
                ? [row(500)]
                : Array.from({ length: 500 }, (_, i) => row(i)),
              error: null,
            });
          },
        };
        return query;
      },
    },
  };
  const response = await GET();
  assert.equal(response.status, 200);
  const rows = (await response.json()).data;
  assert.equal(rows.length, 501);
  assert.equal(rows[0].source, "stall");
  assert.equal(rows[1].source, "general");
  assert.equal(
    rows.some((row: object) => "notes" in row),
    false,
  );
  assert.deepEqual(globals.ordersQueries, [
    {},
    { cursor: String(499).padStart(36, "0") },
  ]);
  globals.ordersAuth = {
    ok: false,
    response: Response.json({}, { status: 401 }),
  };
  assert.equal((await GET()).status, 401);
});

test("orders remain readable before the fulfillment migration is installed", async () => {
  let attempts = 0;
  globals.ordersAuth = {
    ok: true,
    supabase: {
      from() {
        let selection = "";
        const query = {
          select(value: string) {
            selection = value;
            return query;
          },
          is() {
            return query;
          },
          order() {
            return query;
          },
          limit() {
            return query;
          },
          then(resolve: (value: unknown) => void) {
            attempts++;
            resolve(
              selection.includes("claim_submission_id")
                ? { data: null, error: { code: "42703" } }
                : {
                    data: [
                      {
                        id: "old-order",
                        created_at: "2026-10-20",
                        notes: null,
                      },
                    ],
                    error: null,
                  },
            );
          },
        };
        return query;
      },
    },
  };
  const response = await GET();
  assert.equal(response.status, 200);
  assert.equal(attempts, 2);
  assert.equal((await response.json()).data[0].source, "general");
});
