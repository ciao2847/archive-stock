import assert from "node:assert/strict";
import test from "node:test";
import { claimCustomerSearchFilter } from "../src/lib/claim-search.ts";

test("customer search preserves names, phone fragments and codes as literal case-insensitive filters", () => {
  for (const query of [
    " james ",
    "0933",
    "HD-CLAIM-1",
    '王小明,(x)"',
    "%_\\",
  ]) {
    const filter = claimCustomerSearchFilter(query);
    const value = JSON.stringify(
      `%${query.trim().replace(/[\\%_]/g, "\\$&")}%`,
    );
    assert.equal(
      filter,
      ["nickname", "phone_normalized", "confirmation_code"]
        .map((column) => `${column}.ilike.${value}`)
        .join(","),
    );
  }
});
