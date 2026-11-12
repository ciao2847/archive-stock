import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
const state = globalThis as typeof globalThis & { nameAuth: unknown };
const bundle = await build({
  entryPoints: ["src/app/api/customer-name/route.ts"],
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
          contents: `export const requireApiUser=async()=>globalThis.nameAuth;export const apiSuccess=data=>Response.json({data});export const apiFailure=(error,status)=>Response.json({error},{status});export const withApiErrorHandling=async(_,cb)=>cb();`,
        }));
      },
    },
  ],
});
const { PATCH } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const owner = "00000000-0000-4000-8000-000000000001";
function request(extra = {}, cross = false) {
  return new Request("https://example.com/api/customer-name", {
    method: "PATCH",
    headers: cross ? { "sec-fetch-site": "cross-site" } : {},
    body: JSON.stringify({
      ownerId: owner,
      source: "claim",
      recordId: "1",
      expectedName: "Old",
      name: "Correct",
      ...extra,
    }),
  });
}
test("name endpoint validates permissions and payload before invoking the atomic operation", async () => {
  const calls: unknown[] = [];
  state.nameAuth = {
    ok: true,
    role: "staff",
    inventoryOwnerId: owner,
    supabase: {
      async rpc(name: string, args: unknown) {
        calls.push([name, args]);
        return { data: true, error: null };
      },
    },
  };
  assert.equal((await PATCH(request())).status, 200);
  assert.deepEqual(calls, [
    [
      "update_order_customer_name",
      {
        p_owner_id: owner,
        p_source: "claim",
        p_record_id: "1",
        p_expected_name: "Old",
        p_name: "Correct",
      },
    ],
  ]);
  for (const extra of [
    { name: " " },
    { name: "a".repeat(101) },
    { recordId: "1 or true" },
    { source: "order", recordId: "1" },
    { source: "invalid" },
  ])
    assert.equal((await PATCH(request(extra))).status, 400);
  assert.equal(
    (await PATCH(request({ ownerId: "00000000-0000-4000-8000-000000000002" })))
      .status,
    403,
  );
  assert.equal((await PATCH(request({}, true))).status, 403);
  assert.equal(calls.length, 1);
  state.nameAuth = {
    ok: false,
    response: Response.json({ error: "login" }, { status: 401 }),
  };
  assert.equal((await PATCH(request())).status, 401);
});
test("stale names and removed records return actionable errors", async () => {
  for (const [message, status] of [
    ["customer name changed", 409],
    ["name record not found", 404],
  ] as const) {
    state.nameAuth = {
      ok: true,
      role: "staff",
      inventoryOwnerId: owner,
      supabase: {
        async rpc() {
          return { data: null, error: { message } };
        },
      },
    };
    assert.equal((await PATCH(request())).status, status);
  }
});
