import assert from "node:assert/strict";
import test from "node:test";
import { filterClaimOrders } from "../src/lib/order-search.ts";
import type { ClaimSubmission } from "../src/lib/claims.ts";

const rows: ClaimSubmission[] = ["claim", "bundle"].map((source, index) => ({
  source: source as "claim" | "bundle",
  id: index + 1,
  formId: index + 1,
  formTitle: `活動 ${index}`,
  confirmationCode: `${source.toUpperCase()}-001`,
  nickname: "小美",
  phone: "0912345678",
  paymentStatus: "pending",
  createdAt: `2026-10-${19 + index}T00:00:00Z`,
  items: [
    { id: 1, sku: "POSTER-01", name: "測試海報", quantity: 1, unitPrice: 600 },
  ],
  payments: [],
}));
test("all order lookup finds claim and bundle confirmation codes across activities", () => {
  assert.equal(filterClaimOrders(rows, "all", "claim-001")[0]?.source, "claim");
  assert.equal(
    filterClaimOrders(rows, "all", "BUNDLE-001")[0]?.source,
    "bundle",
  );
  for (const query of ["091234", "小美", "海報", "poster-01"]) {
    assert.equal(filterClaimOrders(rows, "all", query).length, 2);
  }
  assert.equal(filterClaimOrders(rows, "claim", "").length, 1);
  assert.equal(filterClaimOrders(rows, "bundle", "").length, 1);
  assert.equal(filterClaimOrders(rows, "general", "").length, 0);
  assert.equal(filterClaimOrders(rows, "all", "找不到").length, 0);
  assert.equal(filterClaimOrders(rows, "all", "")[0]?.source, "bundle");
});
