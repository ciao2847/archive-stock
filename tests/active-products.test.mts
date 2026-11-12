import assert from "node:assert/strict";
import test from "node:test";
import { readActiveProducts } from "../src/lib/api/active-products.ts";

test("a database without the merge column can still return the scoped product catalog", async () => {
  for (const error of [
    {
      code: "42703",
      message: "column products.merged_into_product_id does not exist",
    },
  ]) {
    const calls: boolean[] = [];
    const result = await readActiveProducts(async (filterMerged) => {
      calls.push(filterMerged);
      return filterMerged
        ? { data: null, error }
        : { data: [{ id: "visible-owned-product" }], error: null };
    });
    assert.deepEqual(result, {
      data: [{ id: "visible-owned-product" }],
      error: null,
    });
    assert.deepEqual(calls, [true, false]);
  }
});
test("an installed schema keeps retirement filtering; authorization and unrelated errors never trigger an unfiltered retry", async () => {
  for (const error of [
    null,
    { code: "42501", message: "permission denied for table products" },
    { code: "42703", message: "column products.other_column does not exist" },
    {
      code: "PGRST204",
      message:
        "Could not find the 'merged_into_product_id' column of 'products' in the schema cache",
    },
    { code: "PGRST205", message: "products table missing" },
    { code: "XX000", message: "products.merged_into_product_id error" },
  ]) {
    let calls = 0;
    const expected = { data: error ? null : [{ id: "active-product" }], error };
    const result = await readActiveProducts(async (filterMerged) => {
      calls++;
      assert.equal(filterMerged, true);
      return expected;
    });
    assert.equal(result, expected);
    assert.equal(calls, 1);
  }
});
test("a failed compatibility read reports its own error without further retries", async () => {
  const failure = {
    data: null,
    error: { code: "42501", message: "permission denied" },
  };
  let calls = 0;
  assert.equal(
    await readActiveProducts(async (filterMerged) => {
      calls++;
      return filterMerged
        ? {
            data: null,
            error: {
              code: "42703",
              message: "column products.merged_into_product_id does not exist",
            },
          }
        : failure;
    }),
    failure,
  );
  assert.equal(calls, 2);
});
