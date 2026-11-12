import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const state = globalThis as typeof globalThis & {
  phoneAuth: unknown;
  phoneService: unknown;
};
const result = await build({
  entryPoints: ["src/app/api/bundle-claims/route.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  plugins: [
    {
      name: "phone-fixture",
      setup(builder) {
        builder.onResolve({ filter: /api\/server-auth$/ }, () => ({
          path: "auth",
          namespace: "fixture",
        }));
        builder.onResolve(
          { filter: /^server-only$|utils\/supabase\/service$/ },
          () => ({ path: "service", namespace: "fixture" }),
        );
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({
          contents:
            path === "auth"
              ? `export const requireApiUser=async()=>globalThis.phoneAuth;export const apiSuccess=(data,status=200)=>Response.json({data},{status});export const apiFailure=(error,status)=>Response.json({error},{status});export const withApiErrorHandling=async(_,callback)=>callback();`
              : `export const createServiceClient=()=>globalThis.phoneService;`,
        }));
      },
    },
  ],
});
const { PATCH } = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
);
const owner = "00000000-0000-4000-8000-000000000001";
const timestamp = "2026-11-05T00:00:00.000Z";
function setup(found = true) {
  const calls: unknown[][] = [];
  const chain = {
    from(...args: unknown[]) {
      calls.push(["from", ...args]);
      return chain;
    },
    update(...args: unknown[]) {
      calls.push(["update", ...args]);
      return chain;
    },
    eq(...args: unknown[]) {
      calls.push(["eq", ...args]);
      return chain;
    },
    select() {
      return chain;
    },
    async maybeSingle() {
      return { data: found ? { id: 3 } : null, error: null };
    },
  };
  state.phoneAuth = { ok: true, role: "staff", inventoryOwnerId: owner };
  state.phoneService = chain;
  return calls;
}
function request(overrides = {}) {
  return PATCH(
    new Request("http://localhost/api/bundle-claims", {
      method: "PATCH",
      body: JSON.stringify({
        action: "update_phone",
        ownerId: owner,
        orderId: 3,
        phone: "0912345678",
        expectedUpdatedAt: timestamp,
        ...overrides,
      }),
    }),
  );
}
test("updates both phone identities with owner, confirmed state and version filters", async () => {
  const calls = setup();
  assert.equal((await request()).status, 200);
  const update = calls.find(([name]) => name === "update")?.[1] as Record<
    string,
    unknown
  >;
  assert.equal(update.customer_phone, "0912345678");
  assert.equal(update.customer_phone_normalized, "0912345678");
  for (const filter of [
    ["eq", "owner_id", owner],
    ["eq", "id", 3],
    ["eq", "status", "confirmed"],
    ["eq", "updated_at", timestamp],
  ])
    assert.ok(
      calls.some((call) => JSON.stringify(call) === JSON.stringify(filter)),
    );
});
test("rejects invalid phones and foreign inventory before accessing service client", async () => {
  const calls = setup();
  assert.equal((await request({ phone: "123" })).status, 400);
  assert.equal(
    (await request({ ownerId: "00000000-0000-4000-8000-000000000002" })).status,
    403,
  );
  assert.deepEqual(calls, []);
});
test("reports a conflict when the order no longer matches", async () => {
  setup(false);
  assert.equal((await request()).status, 409);
});
