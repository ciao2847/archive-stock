import assert from "node:assert/strict";
import { test } from "node:test";
import { getListPrice } from "../src/lib/pricing.ts";

test("list price adds NT$150 to the member price, including zero and decimals", () => {
  assert.equal(getListPrice(200), 350);
  assert.equal(getListPrice(0), 150);
  assert.equal(getListPrice(199.99), 349.99);
});
