import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
const state = globalThis as typeof globalThis & { mergeAuth: unknown };
const bundle = await build({
  entryPoints: ["src/app/api/products/merge/route.ts"],
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
          contents: `export const requireApiUser=async()=>globalThis.mergeAuth;export const apiSuccess=data=>Response.json({success:true,data});export const apiFailure=(error,status)=>Response.json({success:false,error},{status});export const withApiErrorHandling=async(_,cb)=>cb();`,
        }));
      },
    },
  ],
});
const { POST } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const input = { ownerId: id(1), sourceId: id(10), targetId: id(11) };
const token = "a".repeat(32);
const request = (extra = {}, cross = false) =>
  new Request("https://example.com/api/products/merge", {
    method: "POST",
    headers: cross ? { "sec-fetch-site": "cross-site" } : {},
    body: JSON.stringify({ ...input, ...extra }),
  });
test("merge API separates previews from explicit confirmation and validates access before RPC", async () => {
  const calls: unknown[] = [];
  state.mergeAuth = {
    ok: true,
    role: "staff",
    inventoryOwnerId: id(1),
    supabase: {
      async rpc(name: string, args: Record<string, unknown>) {
        calls.push([name, args]);
        return { data: { merged: args.p_apply, token }, error: null };
      },
    },
  };
  assert.equal((await POST(request())).status, 200);
  assert.equal((await POST(request({ token }))).status, 200);
  assert.deepEqual(calls, [
    [
      "merge_preorder_product",
      {
        p_owner_id: id(1),
        p_source_id: id(10),
        p_target_id: id(11),
        p_apply: false,
        p_expected_token: undefined,
      },
    ],
    [
      "merge_preorder_product",
      {
        p_owner_id: id(1),
        p_source_id: id(10),
        p_target_id: id(11),
        p_apply: true,
        p_expected_token: token,
      },
    ],
  ]);
  for (const extra of [
    { sourceId: "bad" },
    { targetId: id(10) },
    { token: "" },
    { token: "b" },
    { ownerId: "bad" },
  ])
    assert.equal((await POST(request(extra))).status, 400);
  assert.equal((await POST(request({ ownerId: id(2) }))).status, 403);
  assert.equal((await POST(request({}, true))).status, 403);
  assert.equal(calls.length, 2);
  state.mergeAuth = {
    ok: false,
    response: Response.json({ error: "login" }, { status: 401 }),
  };
  assert.equal((await POST(request())).status, 401);
});
test("merge API exposes actionable conflicts, stale previews, missing migrations and lock contention", async () => {
  for (const [message, code, status] of [
    ["merge preview changed", "P0001", 409],
    ["merge order conflict", "P0001", 409],
    ["product already merged", "P0001", 409],
    ["merge product not found", "P0001", 404],
    ["missing", "PGRST202", 503],
    ["locked", "55P03", 409],
    ["deadlock", "40P01", 409],
  ] as const) {
    state.mergeAuth = {
      ok: true,
      role: "staff",
      inventoryOwnerId: id(1),
      supabase: {
        async rpc() {
          return { data: null, error: { message, code } };
        },
      },
    };
    const response = await POST(request({ token }));
    assert.equal(response.status, status);
    assert.ok((await response.json()).error);
  }
  state.mergeAuth = {
    ok: true,
    role: "staff",
    inventoryOwnerId: id(1),
    supabase: {
      async rpc() {
        return { data: null, error: null };
      },
    },
  };
  assert.equal((await POST(request({ token }))).status, 503);
});
