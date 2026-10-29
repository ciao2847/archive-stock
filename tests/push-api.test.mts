import assert from "node:assert/strict";
import { test } from "node:test";
import { createECDH, randomBytes } from "node:crypto";
import { build } from "esbuild";
const bundle = await build({
  entryPoints: ["src/app/api/push/subscriptions/route.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  plugins: [
    {
      name: "push-api-fixtures",
      setup(b) {
        b.onResolve({ filter: /api\/server-auth$/ }, () => ({
          path: "auth",
          namespace: "fixture",
        }));
        b.onResolve({ filter: /push\/server$/ }, () => ({
          path: "push",
          namespace: "fixture",
        }));
        b.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
          contents:
            args.path === "auth"
              ? "export const requireApiUser=async()=>globalThis.pushAuth;export const apiFailure=(error,status)=>Response.json({success:false,error},{status});export const apiSuccess=data=>Response.json({success:true,data});export const withApiErrorHandling=async(_,fn)=>fn();"
              : "export const pushConfiguration=()=>({publicKey:'public'});",
        }));
      },
    },
  ],
});
const { POST, DELETE } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const owner = "00000000-0000-4000-8000-000000000001",
  other = "00000000-0000-4000-8000-000000000002";
const ecdh = createECDH("prime256v1");
ecdh.generateKeys();
const input = {
  endpoint: "https://web.push.apple.com/test",
  keys: {
    p256dh: ecdh.getPublicKey().toString("base64url"),
    auth: randomBytes(16).toString("base64url"),
  },
  inventoryIds: [owner],
};
const fixtures = globalThis as typeof globalThis & { pushAuth: unknown };
function request(
  body: unknown,
  origin = "https://example.com",
  method = "POST",
) {
  return new Request("https://example.com/api/push/subscriptions", {
    method,
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
test("device subscription API requires login, same origin, valid endpoint and own inventory", async () => {
  fixtures.pushAuth = {
    ok: false,
    response: Response.json({ error: "Login" }, { status: 401 }),
  };
  assert.equal((await POST(request(input))).status, 401);
  fixtures.pushAuth = {
    ok: true,
    role: "staff",
    inventoryOwnerId: owner,
    userId: "staff",
    supabase: {
      from() {
        throw new Error("unauthorized DB access");
      },
    },
  };
  assert.equal(
    (await POST(request(input, "https://attacker.test"))).status,
    403,
  );
  assert.equal(
    (await POST(request({ ...input, inventoryIds: [other] }))).status,
    403,
  );
  assert.equal(
    (await POST(request({ ...input, endpoint: "https://127.0.0.1/" }))).status,
    400,
  );
  const writes: Array<Record<string, unknown>> = [],
    filters: unknown[] = [];
  fixtures.pushAuth = {
    ok: true,
    role: "staff",
    inventoryOwnerId: owner,
    userId: "staff",
    supabase: {
      from(table: string) {
        assert.equal(table, "web_push_subscriptions");
        const query = {
          upsert(value: Record<string, unknown>) {
            writes.push(value);
            return query;
          },
          select() {
            return query;
          },
          single: async () => ({ data: { id: "device" }, error: null }),
          delete() {
            return query;
          },
          eq(key: string, value: unknown) {
            filters.push([key, value]);
            return query;
          },
          then: (resolve: (value: unknown) => void) => resolve({ error: null }),
        };
        return query;
      },
    },
  };
  assert.equal((await POST(request(input))).status, 200);
  assert.equal(writes[0].user_id, "staff");
  assert.deepEqual(writes[0].inventory_ids, [owner]);
  assert.equal(
    (
      await DELETE(
        request({ endpoint: input.endpoint }, "https://example.com", "DELETE"),
      )
    ).status,
    200,
  );
  assert.ok(
    filters.some(
      (value) => JSON.stringify(value) === JSON.stringify(["user_id", "staff"]),
    ),
  );
  delete (globalThis as Record<string, unknown>).pushAuth;
});
