import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
const buildResult = await build({
  entryPoints: ["src/lib/preorder-import.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
});
const { parsePreorderText, preorderRowErrors, PREORDER_IMPORT_EXAMPLE } =
  (await import(
    `data:text/javascript;base64,${Buffer.from(buildResult.outputFiles[0].text).toString("base64")}`
  )) as typeof import("../src/lib/preorder-import.ts");
const defaults = { work: "蜘蛛人", country: "", size: "", format: "" };
test("free text expands country variants, inherits size and keeps explicit prices", () => {
  const { rows, warnings } = parsePreorderText(
    PREORDER_IMPORT_EXAMPLE,
    defaults,
  );
  assert.equal(rows.length, 5);
  assert.deepEqual(
    rows.map((r) => [r.country, r.itemName, r.price, r.work, r.size, r.format]),
    [
      ["韓國", "A款", "350", "蜘蛛人", "A3", ""],
      ["韓國", "B款", "350", "蜘蛛人", "A3", ""],
      ["韓國", "C款", "350", "蜘蛛人", "A3", ""],
      ["日本", "全員款", "450", "蜘蛛人", "A3", ""],
      ["北美", "肖像款", "500", "蜘蛛人", "A3", "特別場"],
    ],
  );
  assert.deepEqual(warnings, []);
  for (const row of rows) assert.deepEqual(preorderRowErrors(row, true), []);
});
test("inline country changes, individual prices, flags and free item names are distinct", () => {
  const { rows } = parsePreorderText(
    "韓版a款350、b款400，日版全員款450，🇲🇾 月光下的約定各1,250元",
    defaults,
  );
  assert.equal(rows.length, 4);
  assert.deepEqual(
    rows.map((r) => [r.country, r.price]),
    [
      ["韓國", "350"],
      ["韓國", "400"],
      ["日本", "450"],
      ["馬來西亞", "1250"],
    ],
  );
  assert.equal(rows[3].itemName, "月光下的約定");
});
test("ambiguous group prices and foreign currencies require a manually confirmed NT$ amount", () => {
  for (const text of ["韓版A/B/C 350", "美版肖像款 USD 10"]) {
    const { rows } = parsePreorderText(text, defaults);
    assert.ok(rows.length > 0);
    for (const row of rows) {
      assert.equal(row.price, "");
      assert.ok(preorderRowErrors(row, true).length > 0);
    }
  }
  const { rows } = parsePreorderText("韓版A+B+C一套350元", defaults);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].price, "350");
  assert.match(rows[0].itemName, /套組/);
});
test("missing countries, missing prices and size/version-only lines never silently become valid products", () => {
  const { rows } = parsePreorderText(
    "全部A3\n版本IMAX\n韓版肖像款\n全員款350",
    defaults,
  );
  assert.equal(rows.length, 2);
  assert.ok(preorderRowErrors(rows[0], true).length);
  assert.ok(preorderRowErrors(rows[1], true).length);
  assert.equal(rows[0].size, "A3");
  assert.equal(rows[0].format, "IMAX");
  assert.equal(parsePreorderText("", defaults).rows.length, 0);
  const many = parsePreorderText(
    Array(60).fill("韓版A款各350").join("\n"),
    defaults,
  );
  assert.equal(many.limitExceeded, true);
});

test("explicit titles with years remain work names rather than prices", () => {
  const { rows } = parsePreorderText(
    "作品：蜘蛛人2026\n韓版 IMAX A款各350元\n日版肖像款450",
    defaults,
  );
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.work === "蜘蛛人2026"));
  assert.equal(rows[0].itemName, "IMAX A款");
  assert.equal(rows[0].format, "IMAX");
});

test("fan-made versions are recognized with the palette label", () => {
  const { rows } = parsePreorderText("🎨 飯製 A款350元", defaults);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].country, "飯製");
  assert.equal(rows[0].price, "350");
});
