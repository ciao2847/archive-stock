import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const bundle = await build({
  entryPoints: ["src/lib/fanmade/craft-text.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
});
const { parseFanmadeCraftText } = (await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
)) as typeof import("../src/lib/fanmade/craft-text.ts");

test("craft text accepts one craft per line and preserves interior spaces and numbered names", () => {
  assert.deepEqual(
    parseFanmadeCraftText(" 亮銀龍 \r\n\n水 波 紋\r3D光柵\n3D 光柵", "10"),
    {
      items: [
        { craft: "亮銀龍", stock: 10 },
        { craft: "水 波 紋", stock: 10 },
        { craft: "3D光柵", stock: 10 },
        { craft: "3D 光柵", stock: 10 },
      ],
      errors: [],
      warnings: [],
    },
  );
});
test("craft text accepts Chinese and English list separators", () => {
  const result = parseFanmadeCraftText(
    "亮銀龍、水波紋，雷射,燙金；霧面;3D光柵",
    "0",
  );
  assert.deepEqual(
    result.items.map((item) => item.craft),
    ["亮銀龍", "水波紋", "雷射", "燙金", "霧面", "3D光柵"],
  );
  assert.ok(result.items.every((item) => item.stock === 0));
  assert.deepEqual(result.errors, []);
});
test("craft text supports pipe, full-width pipe, tab and trailing numeric stock", () => {
  const result = parseFanmadeCraftText(
    "亮銀龍｜10\n水波紋 | 5\n霧面\t0\n雷射 1000",
    "2",
  );
  assert.deepEqual(result.items, [
    { craft: "亮銀龍", stock: 10 },
    { craft: "水波紋", stock: 5 },
    { craft: "霧面", stock: 0 },
    { craft: "雷射", stock: 1000 },
  ]);
  assert.deepEqual(result.errors, []);
});
test("craft text defaults only rows with no explicit stock", () => {
  const result = parseFanmadeCraftText("亮銀龍\n水波紋｜3", "7");
  assert.deepEqual(result.items, [
    { craft: "亮銀龍", stock: 7 },
    { craft: "水波紋", stock: 3 },
  ]);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(parseFanmadeCraftText("亮銀龍｜2", "").errors, []);
});
test("editing one image keeps existing craft stock when only names are pasted", () => {
  const result = parseFanmadeCraftText("亮銀龍、水波紋、雷射", "3", {
    stockDefaults: { 亮銀龍: "10", 水波紋: "6" },
  });
  assert.deepEqual(result.items, [
    { craft: "亮銀龍", stock: 10 },
    { craft: "水波紋", stock: 6 },
    { craft: "雷射", stock: 3 },
  ]);
  assert.deepEqual(result.errors, []);
});
test("per-image explicit stock overrides only the named craft", () => {
  const result = parseFanmadeCraftText("亮銀龍｜2\n水波紋\n雷射 5", "0", {
    stockDefaults: { 亮銀龍: "10", 水波紋: "6" },
  });
  assert.deepEqual(result.items, [
    { craft: "亮銀龍", stock: 2 },
    { craft: "水波紋", stock: 6 },
    { craft: "雷射", stock: 5 },
  ]);
  assert.deepEqual(result.errors, []);
});
test("invalid existing stock is reported rather than replaced by an image default", () => {
  const result = parseFanmadeCraftText("亮銀龍", "3", {
    stockDefaults: { 亮銀龍: "" },
  });
  assert.deepEqual(result.items, []);
  assert.match(result.errors[0], /保留既有庫存.*整數/);
});
test("image stock defaults do not treat inherited property names as stock values", () => {
  const result = parseFanmadeCraftText("constructor\ntoString", "3", {
    stockDefaults: {},
  });
  assert.deepEqual(result.items, [
    { craft: "constructor", stock: 3 },
    { craft: "toString", stock: 3 },
  ]);
  assert.deepEqual(result.errors, []);
});
test("craft text refuses missing, negative, fractional, nonfinite, oversized and malformed explicit stock", () => {
  for (const invalid of [
    "",
    "-1",
    "-0",
    "+1",
    "1.5",
    "1e3",
    "NaN",
    "Infinity",
    "1001",
    "abc",
    "10張",
  ]) {
    const result = parseFanmadeCraftText(`亮銀龍｜${invalid}`, "10");
    assert.deepEqual(result.items, [], invalid);
    assert.equal(result.errors.length, 1, invalid);
    assert.match(result.errors[0], /庫存.*整數/);
  }
  assert.match(parseFanmadeCraftText("亮銀龍\t", "10").errors[0], /庫存/);
});
test("craft text validates defaults rather than quietly treating blank stock as zero", () => {
  for (const invalid of ["", "-1", "1.5", "1001", "abc"]) {
    const result = parseFanmadeCraftText("亮銀龍", invalid);
    assert.deepEqual(result.items, []);
    assert.match(result.errors[0], /預設庫存.*庫存/);
  }
});
test("craft text recognizes invalid numeric whitespace stock without changing valid craft names", () => {
  for (const invalid of ["-1", "1.5", "1e3", "NaN", "Infinity"]) {
    const result = parseFanmadeCraftText(`亮銀龍 ${invalid}`, "10");
    assert.deepEqual(result.items, []);
    assert.match(result.errors[0], /庫存/);
  }
  assert.deepEqual(parseFanmadeCraftText("光柵 3D", "4").items, [
    { craft: "光柵 3D", stock: 4 },
  ]);
});
test("craft text merges exact repeated craft and stock with an explicit warning", () => {
  const result = parseFanmadeCraftText("亮銀龍\n亮銀龍|10\n亮銀龍 10", "10");
  assert.deepEqual(result.items, [{ craft: "亮銀龍", stock: 10 }]);
  assert.deepEqual(result.errors, []);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /重複/);
});
test("craft text rejects conflicting quantities for the same craft", () => {
  const result = parseFanmadeCraftText("亮銀龍｜10\n亮銀龍｜5", "0");
  assert.equal(result.items.length, 1);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /第 2 行.*不同庫存.*10、5/);
  assert.deepEqual(result.warnings, []);
});
test("craft text can preserve repeated crafts for one-entry-per-image assignment", () => {
  const result = parseFanmadeCraftText(
    "亮銀龍｜10\n亮銀龍｜5\n亮銀龍｜5",
    "0",
    { preserveDuplicates: true },
  );
  assert.deepEqual(result.items, [
    { craft: "亮銀龍", stock: 10 },
    { craft: "亮銀龍", stock: 5 },
    { craft: "亮銀龍", stock: 5 },
  ]);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
  const tooMany = parseFanmadeCraftText(
    Array(51).fill("亮銀龍").join("\n"),
    "10",
    { preserveDuplicates: true },
  );
  assert.equal(tooMany.items.length, 51);
  assert.match(tooMany.errors[0], /最多 50.*51/);
});
test("craft text reports invalid names and empty entries instead of silently discarding them", () => {
  assert.match(parseFanmadeCraftText("｜10", "0").errors[0], /工藝名稱/);
  assert.match(
    parseFanmadeCraftText("工".repeat(101), "0").errors[0],
    /100 字/,
  );
  assert.equal(parseFanmadeCraftText("工".repeat(100), "0").items.length, 1);
  const result = parseFanmadeCraftText("亮銀龍、、水波紋", "10");
  assert.equal(result.items.length, 2);
  assert.match(result.errors[0], /第 1 行第 2 項.*工藝名稱/);
});
test("craft text counts Unicode code points consistently with the database", () => {
  assert.deepEqual(parseFanmadeCraftText("✨".repeat(100), "0").errors, []);
  assert.match(
    parseFanmadeCraftText("✨".repeat(101), "0").errors[0],
    /100 字/,
  );
});
test("craft text reports more than fifty unique crafts without truncation", () => {
  const result = parseFanmadeCraftText(
    Array.from({ length: 51 }, (_, i) => `工藝${i}`).join("\n"),
    "1",
  );
  assert.equal(result.items.length, 51);
  assert.match(result.errors[0], /最多 50.*51/);
  assert.equal(
    parseFanmadeCraftText(Array(60).fill("亮銀龍").join("\n"), "1").items
      .length,
    1,
  );
});
test("craft text retains valid entries while exposing every invalid line to prevent partial application", () => {
  const result = parseFanmadeCraftText(
    "亮銀龍｜1\n水波紋｜-2\n雷射｜0\n霧面｜1.2",
    "10",
  );
  assert.deepEqual(result.items, [
    { craft: "亮銀龍", stock: 1 },
    { craft: "雷射", stock: 0 },
  ]);
  assert.equal(result.errors.length, 2);
  assert.match(result.errors[0], /第 2 行/);
  assert.match(result.errors[1], /第 4 行/);
});
test("craft text refuses ambiguous columns and grouped numeric quantities", () => {
  for (const input of [
    "亮銀龍|10|5",
    "亮銀龍|10、水波紋|5",
    "亮銀龍|1,000",
    "亮銀龍 1,000",
  ]) {
    const result = parseFanmadeCraftText(input, "2");
    assert.equal(result.items.length, 0, input);
    assert.ok(result.errors.length, input);
  }
});
test("craft text rejects blank input and accepts the stock boundary values", () => {
  assert.match(parseFanmadeCraftText(" \n\t", "0").errors[0], /至少輸入/);
  assert.deepEqual(parseFanmadeCraftText("零庫存|0\n滿庫存|1000", "").items, [
    { craft: "零庫存", stock: 0 },
    { craft: "滿庫存", stock: 1000 },
  ]);
});
