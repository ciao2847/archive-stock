import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
const built = await build({
  entryPoints: ["src/lib/accounting-excel.ts", "src/lib/accounting-details.ts"],
  outdir: "/tmp/poster-finance-tests",
  bundle: true,
  write: false,
  format: "cjs",
  platform: "node",
  external: ["exceljs"],
});
function load<T>(suffix: string) {
  const code = built.outputFiles.find((file) =>
    file.path.endsWith(suffix),
  )!.text;
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", code)(
    createRequire(import.meta.url),
    cjsModule,
    cjsModule.exports,
  );
  return cjsModule.exports as T;
}
const { allocateProfit, periodDetailsSchema, percentToBasisPoints } = load<
  typeof import("../src/lib/accounting-details.ts")
>("accounting-details.js");
const { buildAccountingWorkbook, buildCombinedAccountingWorkbook } = load<
  typeof import("../src/lib/accounting-excel.ts")
>("accounting-excel.js");
const uid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const entries = [
  {
    id: uid(2),
    date: "2026-09-10",
    category: "國際運費",
    name: "第一批國際運費",
    amount: 1000.01,
    notes: "韓國",
  },
  {
    id: uid(3),
    date: "2026-10-10",
    category: "商品購入",
    name: "商品購入",
    amount: 5000,
    notes: "",
  },
];
const shares = [
  { id: uid(4), name: "甲", basisPoints: 6000 },
  { id: uid(5), name: "乙", basisPoints: 4000 },
];
const input = {
  ownerId: uid(1),
  start: "2026-09-01",
  end: "2026-10-31",
  entries,
  shares,
  notes: "",
  expectedRevision: 0,
  confirmed: true,
};
test("itemized costs validate dates, cents, identity and complete share ratios", () => {
  assert.equal(periodDetailsSchema.safeParse(input).success, true);
  for (const patch of [
    { confirmed: false },
    { entries: [{ ...entries[0], date: "2026-08-31" }] },
    { entries: [{ ...entries[0], amount: 0.001 }] },
    { entries: [entries[0], entries[0]] },
    { shares: [{ ...shares[0], basisPoints: 6001 }, shares[1]] },
    { shares: [{ ...shares[0], name: "乙" }, shares[1]] },
  ])
    assert.equal(
      periodDetailsSchema.safeParse({ ...input, ...patch }).success,
      false,
    );
  assert.equal(percentToBasisPoints("14.51"), 1451);
  assert.ok(Number.isNaN(percentToBasisPoints("14.511")));
});
test("profit is allocated exactly in cents, including ties and large amounts; losses use the same ratios", () => {
  assert.deepEqual(
    allocateProfit(100.01, shares).map((row) => row.amount),
    [60.01, 40],
  );
  assert.deepEqual(
    allocateProfit(-20, shares).map((row) => row.amount),
    [-12, -8],
  );
  for (const profit of [
    0, 0.01, 0.02, 1.01, 12345.67, 999999999999.99, -0.01, -1000.01,
    -999999999999.99,
  ]) {
    const result = allocateProfit(profit, [
      { id: uid(4), name: "甲", basisPoints: 3333 },
      { id: uid(5), name: "乙", basisPoints: 3333 },
      { id: uid(6), name: "丙", basisPoints: 3334 },
    ]);
    assert.equal(
      result.reduce((total, row) => total + Math.round(row.amount * 100), 0),
      Math.round(profit * 100),
    );
  }
});
test("Excel contains reconcilable overview, orders, itemized costs and shares, with plain text names", async () => {
  const workbook = await buildAccountingWorkbook({
    period: { start: input.start, end: input.end },
    cost: {
      id: uid(7),
      owner_id: uid(1),
      period_start: input.start,
      period_end: input.end,
      amount: 6000.01,
      notes: "備註",
      revision: 1,
      updated_at: "2026-10-21T01:00:00Z",
      cost_entries: entries,
      share_rules: shares,
    },
    preview: {
      revenue: 10000.02,
      order_count: 1,
      settled: true,
      blocked_reason: null,
    },
    settlementNo: "S-1",
    orders: [
      {
        orderId: uid(8),
        orderNo: "O-1",
        date: "2026-10-10",
        customer: '=HYPERLINK("https://example.com")',
        status: "packed",
        revenue: 10000.02,
        discount: 0,
        items: [
          { sku: "A001", name: "海報1", quantity: 1, unitPrice: 5000.01 },
          { sku: "A002", name: "海報2", quantity: 1, unitPrice: 5000.01 },
        ],
      },
    ],
  });
  assert.deepEqual(
    workbook.worksheets.map((sheet) => sheet.name),
    ["收支總覽", "訂單明細", "成本明細", "分帳結果"],
  );
  assert.equal(workbook.getWorksheet("訂單明細").getCell("K2").value, 10000.02);
  assert.equal(workbook.getWorksheet("訂單明細").getCell("K3").value, 0);
  assert.equal(workbook.getWorksheet("成本明細").getCell("D4").value, 6000.01);
  assert.equal(workbook.getWorksheet("分帳結果").getCell("C4").value, 4000.01);
  assert.equal(
    typeof workbook.getWorksheet("訂單明細").getCell("C2").value,
    "string",
  );
  const bytes = await workbook.xlsx.writeBuffer();
  assert.ok(bytes.byteLength > 1000);
});

test("loss reports and combined exports keep negative shares and all saved periods", async () => {
  const report = {
    period: { start: input.start, end: input.end },
    cost: {
      id: uid(7),
      owner_id: uid(1),
      period_start: input.start,
      period_end: input.end,
      amount: 1000.01,
      notes: "",
      revision: 1,
      updated_at: "2026-10-21T01:00:00Z",
      cost_entries: [{ ...entries[0], amount: 1000.01 }],
      share_rules: shares,
    },
    preview: {
      revenue: 0,
      order_count: 0,
      settled: false,
      blocked_reason: null,
    },
    settlementNo: null,
    orders: [],
  };
  const workbook = await buildAccountingWorkbook(report);
  assert.equal(workbook.getWorksheet("分帳結果")!.getCell("C2").value, -600.01);
  assert.equal(workbook.getWorksheet("分帳結果")!.getCell("C3").value, -400);
  assert.equal(
    workbook.getWorksheet("分帳結果")!.getCell("C4").value,
    -1000.01,
  );
  const combined = await buildCombinedAccountingWorkbook([
    report,
    { ...report, period: { start: "2026-11-01", end: "2026-12-31" } },
  ]);
  assert.equal(combined.worksheets.length, 4);
  assert.equal(
    combined.getWorksheet("收支總覽")!.getCell("E4").value,
    -2000.02,
  );
  assert.equal(
    combined.getWorksheet("成本明細")!.getCell("A2").value,
    "2026-09-01 ～ 2026-10-31",
  );
  assert.equal(combined.getWorksheet("分帳結果")!.getCell("D2").value, -600.01);
  assert.ok((await combined.xlsx.writeBuffer()).byteLength > 1000);
});
