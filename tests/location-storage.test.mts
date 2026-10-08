import assert from "node:assert/strict";
import { test } from "node:test";
import {
  storageActionSchema,
  unassignedQuantity,
  slotTotals,
} from "../src/lib/location-storage.ts";
const one = "00000000-0000-4000-8000-000000000001",
  two = "00000000-0000-4000-8000-000000000002";
test("partial putaway counts physical sheets without duplicating stock", () => {
  const product = {
    id: one,
    name: "海報",
    country: "韓國",
    price: 500,
    stock: 5,
    allocations: [
      { location_id: one, quantity: 2 },
      { location_id: two, quantity: 1 },
    ],
  };
  assert.equal(unassignedQuantity(product), 2);
  assert.deepEqual(slotTotals([product], one), {
    items: [{ product, quantity: 2 }],
    count: 1,
    quantity: 2,
  });
  assert.equal(unassignedQuantity({ ...product, stock: 1 }), 0);
  assert.equal(slotTotals([product], "empty").quantity, 0);
});
test("cabinet sizes and putaway quantities validate integer bounds", () => {
  assert.equal(
    storageActionSchema.safeParse({
      action: "create_cabinet",
      name: "海報櫃",
      rows: 3,
      columns: 5,
    }).success,
    true,
  );
  assert.equal(
    storageActionSchema.safeParse({
      action: "create_cabinet",
      name: "寬櫃",
      rows: 3,
      columns: 11,
    }).success,
    true,
  );
  assert.equal(
    storageActionSchema.safeParse({
      action: "resize_cabinet",
      id: one,
      name: "上限",
      rows: 99,
      columns: 99,
    }).success,
    true,
  );
  for (const rows of [0, 100, 1.5])
    assert.equal(
      storageActionSchema.safeParse({
        action: "create_cabinet",
        name: "櫃",
        rows,
        columns: 5,
      }).success,
      false,
    );
  for (const quantity of [0, -1, 1001, 1.5])
    assert.equal(
      storageActionSchema.safeParse({
        action: "putaway",
        locationId: one,
        items: [{ productId: two, quantity }],
      }).success,
      false,
    );
  assert.equal(
    storageActionSchema.safeParse({
      action: "putaway",
      locationId: one,
      items: [],
    }).success,
    false,
  );
  assert.equal(
    storageActionSchema.safeParse({
      action: "quick_add",
      name: "新海報",
      country: "日本",
      price: 0,
      quantity: 2,
      locationId: null,
    }).success,
    true,
  );
});
