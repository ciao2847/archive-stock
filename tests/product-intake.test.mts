import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
const bundle = await build({
  entryPoints: ["src/lib/validation/products.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const { createProductSchema, updateProductSchema } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const input = {
  name: "海報",
  price: 100,
  country: "韓國",
  imagePaths: ["main.webp"],
  category: "海報",
  source: "",
  location: "",
  stock: 1,
  format: "",
  size: "",
  crafts: [],
  feature: "",
};
test("intake requires image/country but allows unnamed work and unassigned location", () => {
  const result = createProductSchema.parse(input);
  assert.equal("work" in result, false);
  assert.equal(result.location, "");
  for (const changes of [
    { name: " " },
    { country: " " },
    { imagePaths: [] },
    { price: -1 },
    { stock: 1.5 },
    { location: "wrong" },
  ])
    assert.equal(
      createProductSchema.safeParse({ ...input, ...changes }).success,
      false,
    );
  assert.equal(
    createProductSchema.safeParse({ ...input, price: 0 }).success,
    true,
  );
  assert.equal(updateProductSchema.safeParse(input).success, true);
});
test("separate preorder workflow remains available without images or country", () => {
  assert.equal(
    createProductSchema.safeParse({
      ...input,
      preorderOnly: true,
      stock: 0,
      country: "",
      imagePaths: [],
    }).success,
    true,
  );
  assert.equal(
    createProductSchema.safeParse({ ...input, preorderOnly: true, stock: 1 })
      .success,
    false,
  );
});

test("poster unit cost accepts zero, validates cents, and requires an existing batch revision", () => {
  assert.equal(
    createProductSchema.safeParse({ ...input, unitCost: 0 }).success,
    true,
  );
  for (const unitCost of [-1, 0.001, Infinity, null])
    assert.equal(
      createProductSchema.safeParse({ ...input, unitCost }).success,
      false,
    );
  assert.equal(
    updateProductSchema.safeParse({
      ...input,
      unitCost: 180,
      costBatchId: "00000000-0000-4000-8000-000000000001",
      expectedCostRevision: 1,
    }).success,
    true,
  );
  assert.equal(
    updateProductSchema.safeParse({
      ...input,
      costBatchId: "00000000-0000-4000-8000-000000000001",
    }).success,
    false,
  );
});
