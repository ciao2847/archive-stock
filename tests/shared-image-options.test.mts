import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import type { PublicClaimProduct } from "../src/lib/claims.ts";
const result = await build({
  entryPoints: ["src/lib/shared-image-options.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
});
const { groupClaimProducts, parseOptionNames, fullProductImage } = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
);
test("shared images render once without merging prices, quantities or imageless products", () => {
  const products = [
    {
      id: "a",
      name: "第1款",
      imageUrl: "/one/thumb.webp",
      price: 100,
      maxQuantity: 2,
      isEnabled: true,
    },
    { id: "x", imageUrl: undefined },
    {
      id: "b",
      name: "第2款",
      imageUrl: "/one/thumb.webp",
      price: 200,
      maxQuantity: 3,
      isEnabled: false,
    },
    { id: "y", imageUrl: undefined },
    { id: "z", imageUrl: "/two/thumb.webp" },
  ] as PublicClaimProduct[];
  assert.deepEqual(
    groupClaimProducts(products).map((group: PublicClaimProduct[]) =>
      group.map((product) => product.id),
    ),
    [["a", "b"], ["x"], ["y"], ["z"]],
  );
  assert.equal(groupClaimProducts(products)[0][1], products[2]);
  assert.equal(
    fullProductImage("https://example.com/a/thumb.webp?v=2"),
    "https://example.com/a/main.webp?v=2",
  );
  assert.equal(
    fullProductImage("https://example.com/thumb.webp.png"),
    "https://example.com/thumb.webp.png",
  );
  assert.deepEqual(parseOptionNames(" 第1款， 第2款\n第3款、角色名,\n"), [
    "第1款",
    "第2款",
    "第3款",
    "角色名",
  ]);
});
