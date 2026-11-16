import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
const state = globalThis as typeof globalThis & {
  fanAuth: {
    ok: boolean;
    role?: string;
    inventoryOwnerId?: string;
    supabase?: unknown;
    response?: Response;
  };
  fanCalls: Array<[string, Record<string, unknown>]>;
  fanResult: { data: unknown; error: { code: string; message: string } | null };
};
const bundle = await build({
  entryPoints: ["src/app/api/fanmade/route.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  plugins: [
    {
      name: "auth",
      setup(b) {
        b.onResolve({ filter: /api\/server-auth$/ }, () => ({
          path: "auth",
          namespace: "fixture",
        }));
        b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: `export const requireApiUser=async()=>globalThis.fanAuth;export const apiSuccess=(data,status=200)=>Response.json({success:true,data},{status});export const apiFailure=(error,status)=>Response.json({success:false,error},{status});export const withApiErrorHandling=async(_,fn)=>fn();`,
        }));
      },
    },
  ],
});
const { GET, POST } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const owner = "00000000-0000-4000-8000-000000000001",
  other = "00000000-0000-4000-8000-000000000002";
function setup() {
  state.fanCalls = [];
  state.fanResult = { data: { saved: true }, error: null };
  state.fanAuth = {
    ok: true,
    role: "staff",
    inventoryOwnerId: owner,
    supabase: {
      rpc: async (...args: [string, Record<string, unknown>]) => {
        state.fanCalls.push(args);
        return state.fanResult;
      },
    },
  };
}
const request = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/fanmade", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
test("fanmade API authorizes inventory and rejects cross-site, invalid prices, crafted media paths and quantity fractions", async () => {
  setup();
  state.fanAuth = { ok: false, response: new Response(null, { status: 401 }) };
  assert.equal((await POST(request({}))).status, 401);
  setup();
  assert.equal(
    (await POST(request({ ownerId: other, action: "price", price: 350 })))
      .status,
    403,
  );
  assert.equal(
    (
      await POST(
        request(
          { ownerId: owner, action: "price", price: 350 },
          { origin: "https://evil.test" },
        ),
      )
    ).status,
    403,
  );
  for (const input of [
    { action: "price", price: -1 },
    { action: "price", price: 350.001 },
    {
      action: "video",
      productId: other,
      updatedAt: "2026-11-14T00:00:00Z",
      sourcePath: "../../private/file.mp4",
    },
    {
      action: "stock",
      productId: other,
      updatedAt: "2026-11-14T00:00:00Z",
      stock: 1.5,
      reason: "盤點",
    },
    { action: "publish", formId: 1, productIds: [other, other] },
  ])
    assert.equal(
      (await POST(request({ ownerId: owner, ...input }))).status,
      400,
    );
  assert.equal(state.fanCalls.length, 0);
});
test("fanmade requests use a single inventory-scoped operation with allowlisted fields and preserve migration/conflict errors", async () => {
  setup();
  assert.equal(
    (
      await POST(
        request({
          ownerId: owner,
          action: "price",
          price: 350,
          secret: "ignored",
        }),
      )
    ).status,
    200,
  );
  assert.deepEqual(state.fanCalls[0], [
    "manage_fanmade",
    { p_owner_id: owner, p_action: "price", p_input: { price: 350 } },
  ]);
  assert.equal(
    (
      await GET(
        new Request(
          `http://localhost/api/fanmade?ownerId=${owner}&page=2&query=水波紋&formId=1`,
        ),
      )
    ).status,
    200,
  );
  assert.deepEqual(state.fanCalls[1], [
    "get_fanmade_catalog",
    {
      p_owner_id: owner,
      p_page: 2,
      p_query: "水波紋",
      p_form_id: 1,
    },
  ]);
  state.fanResult = {
    data: null,
    error: { code: "PGRST202", message: "missing" },
  };
  assert.equal(
    (await POST(request({ ownerId: owner, action: "price", price: 350 })))
      .status,
    503,
  );
  state.fanResult = { data: null, error: { code: "22023", message: "stale" } };
  assert.equal(
    (await POST(request({ ownerId: owner, action: "price", price: 350 })))
      .status,
    409,
  );
});
