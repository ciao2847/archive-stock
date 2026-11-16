import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
const state = globalThis as typeof globalThis & {
  procurementAuth: {
    ok: boolean;
    role?: string;
    inventoryOwnerId?: string;
    supabase?: unknown;
    response?: Response;
  };
  procurementCalls: Array<[string, Record<string, unknown>]>;
  procurementResult: {
    data: unknown;
    error: { code: string; message: string } | null;
  };
};
const bundle = await build({
  entryPoints: ["src/app/api/claim-procurement/route.ts"],
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
          contents: `export const requireApiUser=async()=>globalThis.procurementAuth;export const apiSuccess=(data,status=200)=>Response.json({success:true,data},{status});export const apiFailure=(error,status,code)=>Response.json({success:false,error,code},{status});export const withApiErrorHandling=async(_,fn)=>fn();`,
        }));
      },
    },
  ],
});
const { GET, POST } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const owner = "00000000-0000-4000-8000-000000000001",
  other = "00000000-0000-4000-8000-000000000002",
  round = "00000000-0000-4000-8000-000000000003",
  requestId = "00000000-0000-4000-8000-000000000004";
function setup() {
  state.procurementCalls = [];
  state.procurementResult = {
    data: { closedRoundId: round, nextRoundId: other },
    error: null,
  };
  state.procurementAuth = {
    ok: true,
    role: "staff",
    inventoryOwnerId: owner,
    supabase: {
      rpc: async (...args: [string, Record<string, unknown>]) => {
        state.procurementCalls.push(args);
        return state.procurementResult;
      },
    },
  };
}
const body = { ownerId: owner, formId: 1, roundId: round, requestId };
const post = (input: unknown = body, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/claim-procurement", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(input),
  });
test("procurement API requires authenticated inventory scope and validates request identity before any RPC", async () => {
  setup();
  state.procurementAuth = {
    ok: false,
    response: new Response(null, { status: 401 }),
  };
  assert.equal(
    (await GET(new Request("http://localhost/api/claim-procurement"))).status,
    401,
  );
  assert.equal((await POST(post())).status, 401);
  setup();
  assert.equal(
    (
      await GET(
        new Request(
          `http://localhost/api/claim-procurement?ownerId=${other}&formId=1`,
        ),
      )
    ).status,
    403,
  );
  assert.equal((await POST(post({ ...body, ownerId: other }))).status, 403);
  assert.equal(
    (await POST(post(body, { origin: "https://evil.test" }))).status,
    403,
  );
  assert.equal(
    (await POST(post(body, { "sec-fetch-site": "cross-site" }))).status,
    403,
  );
  for (const input of [
    { ...body, roundId: "latest" },
    { ...body, requestId: "invalid" },
    { ...body, formId: 0 },
    { ...body, formId: "1" },
  ])
    assert.equal((await POST(post(input))).status, 400);
  assert.equal(state.procurementCalls.length, 0);
});
test("procurement API passes fixed round and idempotency keys and scopes history reads", async () => {
  setup();
  assert.equal((await POST(post({ ...body, clientTotal: 999 }))).status, 200);
  assert.deepEqual(state.procurementCalls[0], [
    "close_claim_procurement",
    {
      p_owner_id: owner,
      p_form_id: 1,
      p_round_id: round,
      p_request_id: requestId,
    },
  ]);
  assert.equal(
    (
      await GET(
        new Request(
          `http://localhost/api/claim-procurement?ownerId=${owner}&formId=1&roundId=${round}&historyPage=2`,
        ),
      )
    ).status,
    200,
  );
  assert.deepEqual(state.procurementCalls[1], [
    "get_claim_procurement",
    { p_owner_id: owner, p_form_id: 1, p_round_id: round, p_history_page: 2 },
  ]);
  for (const [code, status] of [
    ["PGRST202", 503],
    ["22023", 409],
    ["42501", 403],
    ["P0002", 404],
  ] as const) {
    state.procurementResult = {
      data: null,
      error: { code, message: "fixture" },
    };
    assert.equal((await POST(post())).status, status);
  }
});
