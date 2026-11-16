import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
const bundle = await build({
  entryPoints: ["src/lib/claim-procurement.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
});
const { buildClaimProcurementCsv } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
test("procurement CSV preserves independent craft quantities, quotes values and prevents spreadsheet formulas", () => {
  const csv = buildClaimProcurementCsv({
    lines: [
      {
        productId: "one",
        sku: "SKU-1",
        name: '夜景, "A"',
        ip: "蜘蛛人",
        craft: "亮銀龍",
        quantity: 10,
        customerCount: 3,
        amount: 3500,
      },
      {
        productId: "two",
        sku: "=FORMULA()",
        name: " \t+SUM(1)",
        ip: "@IP",
        craft: "水波紋",
        quantity: 6,
        customerCount: 2,
        amount: 2100,
      },
    ],
  });
  assert.ok(csv.startsWith("\uFEFF"));
  assert.match(csv, /"蜘蛛人","夜景, ""A""","亮銀龍","SKU-1","10","3","3500"/);
  assert.ok(csv.includes('"\'@IP"'));
  assert.ok(csv.includes('"\'=FORMULA()"'));
  assert.ok(csv.includes('"\' \t+SUM(1)"'));
  assert.ok(csv.endsWith("\r\n"));
});
