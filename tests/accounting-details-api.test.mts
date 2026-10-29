import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
const uid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const state = globalThis as typeof globalThis & {
  financeRole: "staff" | "admin" | null;
  financePeriods?: Array<{ start: string; end: string }>;
  financeCalls: Array<{ name: string; args: Record<string, unknown> }>;
  financeResult: {
    data: unknown;
    error: { message: string; code?: string } | null;
  };
};
const built = await build({
  entryPoints: [
    "src/app/api/accounting/route.ts",
    "src/app/api/accounting/export/route.ts",
  ],
  outdir: "/tmp/poster-finance-api",
  outbase: "src",
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  external: ["exceljs"],
  plugins: [
    {
      name: "fixtures",
      setup(builder) {
        builder.onResolve({ filter: /api\/server-auth$/ }, () => ({
          path: "auth",
          namespace: "fixture",
        }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: `export const apiSuccess=(data,status=200)=>Response.json({success:true,data},{status});export const apiFailure=(error,status)=>Response.json({success:false,error},{status});export const withApiErrorHandling=async(_,handler)=>handler();export const requireApiUser=async()=>globalThis.financeRole?{ok:true,role:globalThis.financeRole,inventoryOwnerId:'${uid(1)}',supabase:{rpc:async(name,args)=>{globalThis.financeCalls.push({name,args});return name==='get_financial_report_periods'?{data:globalThis.financePeriods??[],error:null}:globalThis.financeResult;}}}:{ok:false,response:apiFailure('login',401)};`,
        }));
        builder.onResolve({ filter: /^server-only$/ }, () => ({
          path: "empty",
          namespace: "empty",
        }));
        builder.onLoad({ filter: /.*/, namespace: "empty" }, () => ({
          contents: "",
        }));
      },
    },
  ],
});
function load(path: string) {
  const cjsModule = { exports: {} };
  new Function(
    "require",
    "module",
    "exports",
    built.outputFiles.find((file) => file.path.endsWith(path))!.text,
  )(createRequire(import.meta.url), cjsModule, cjsModule.exports);
  return cjsModule.exports as {
    PUT: (request: Request) => Promise<Response>;
    GET: (request: Request) => Promise<Response>;
  };
}
const api = load("api/accounting/route.js");
const exporter = load("api/accounting/export/route.js");
const body = {
  ownerId: uid(1),
  start: "2026-09-01",
  end: "2026-10-31",
  entries: [
    {
      id: uid(2),
      date: "2026-09-01",
      category: "國際運費",
      name: "國際運費",
      amount: 1000,
      notes: "",
    },
  ],
  shares: [
    { id: uid(3), name: "甲", basisPoints: 6000 },
    { id: uid(4), name: "乙", basisPoints: 4000 },
  ],
  notes: "",
  expectedRevision: 0,
  confirmed: true,
};
const request = (value = body) =>
  new Request("https://example.com/api/accounting", {
    method: "PUT",
    body: JSON.stringify(value),
  });
function fixture() {
  state.financeRole = "staff";
  state.financePeriods = [];
  state.financeCalls = [];
  state.financeResult = { data: { revision: 1 }, error: null };
}
test("itemized cost saving authorizes inventory first and uses one atomic RPC with exact shares", async () => {
  fixture();
  state.financeRole = null;
  assert.equal((await api.PUT(request())).status, 401);
  fixture();
  assert.equal(
    (await api.PUT(request({ ...body, ownerId: uid(9) }))).status,
    403,
  );
  assert.equal(state.financeCalls.length, 0);
  fixture();
  assert.equal(
    (await api.PUT(request({ ...body, confirmed: false }))).status,
    400,
  );
  fixture();
  assert.equal((await api.PUT(request())).status, 200);
  assert.equal(state.financeCalls[0].name, "save_financial_period_details");
  assert.deepEqual(state.financeCalls[0].args.p_shares, body.shares);
  fixture();
  state.financeResult.error = { message: "period cost was changed; reload" };
  assert.equal((await api.PUT(request())).status, 409);
});
test("Excel export rejects unauthorized inventory and inconsistent reports, and returns a real workbook", async () => {
  const report = {
    period: { start: body.start, end: body.end },
    cost: {
      id: uid(5),
      amount: 1000,
      revision: 1,
      notes: "",
      cost_entries: body.entries,
      share_rules: body.shares,
    },
    preview: {
      revenue: 3000,
      order_count: 1,
      settled: false,
      blocked_reason: null,
    },
    settlementNo: null,
    orders: [
      {
        orderId: uid(6),
        orderNo: "O-1",
        date: "2026-09-10",
        customer: "甲",
        status: "packed",
        revenue: 3000,
        discount: 0,
        items: [{ sku: "A1", name: "海報", quantity: 1, unitPrice: 3000 }],
      },
    ],
  };
  const get = (ownerId = uid(1)) =>
    exporter.GET(
      new Request(
        `https://example.com/api/accounting/export?${new URLSearchParams({ ownerId, start: body.start, end: body.end })}`,
      ),
    );
  fixture();
  state.financeRole = null;
  assert.equal((await get()).status, 401);
  fixture();
  assert.equal((await get(uid(9))).status, 403);
  assert.equal(state.financeCalls.length, 0);
  fixture();
  state.financeResult.data = { ...report, cost: null };
  assert.equal((await get()).status, 409);
  fixture();
  state.financeResult.data = {
    ...report,
    preview: { ...report.preview, revenue: 3001 },
  };
  assert.equal((await get()).status, 409);
  fixture();
  state.financeResult.data = report;
  const response = await get();
  assert.equal(response.status, 200);
  assert.ok(response.headers.get("content-type")?.includes("spreadsheetml"));
  assert.ok((await response.arrayBuffer()).byteLength > 1000);
  state.financePeriods = [{ start: body.start, end: body.end }];
  const all = await exporter.GET(
    new Request(
      `https://example.com/api/accounting/export?${new URLSearchParams({ ownerId: uid(1), start: body.start, end: body.end, scope: "all" })}`,
    ),
  );
  assert.equal(all.status, 200);
  assert.ok(all.headers.get("content-disposition")?.includes("all-periods"));
  assert.ok((await all.arrayBuffer()).byteLength > 1000);
});
