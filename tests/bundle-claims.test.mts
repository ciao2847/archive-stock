import assert from "node:assert/strict";
import test from "node:test";

import {
  bundleClaimConfirmationSchema,
  bundleClaimDraftSchema,
  bundleClaimQuerySchema,
  canAccessBundleClaimOwner,
  canDeleteBundleClaim,
  canEditBundleClaimEvidence,
  canRecordBundleClaimPayment,
  canSetBundleClaimOutbound,
  deriveBundleClaimStatus,
  formatBundleClaimMoney,
  normalizeTaiwanMobilePhone,
  validateBundleClaimImage,
} from "../src/lib/bundle-claims.ts";

const OWNER_ID = "00000000-0000-4000-8000-000000000001";

test("bundle draft requires a positive two-decimal fixed total", () => {
  const valid = bundleClaimDraftSchema.safeParse({
    ownerId: OWNER_ID,
    title: "顧客 A 海報",
    description: "依截圖為準",
    totalAmount: 1200,
    customerHint: "討論串暱稱",
  });
  assert.equal(valid.success, true);

  for (const totalAmount of [0, -1, 10.001]) {
    assert.equal(
      bundleClaimDraftSchema.safeParse({
        ownerId: OWNER_ID,
        title: "測試",
        totalAmount,
      }).success,
      false,
    );
  }
});

test("customer confirmation accepts only a 09-prefixed Taiwan mobile", () => {
  const base = {
    nickname: "海報迷",
    notes: "",
    consent: true as const,
    requestId: "00000000-0000-4000-8000-000000000002",
    turnstileToken: "verified-token",
  };
  assert.equal(
    bundleClaimConfirmationSchema.safeParse({
      ...base,
      phone: "0912345678",
    }).success,
    true,
  );
  for (const phone of ["091234567", "0812345678", "0912-345-678"]) {
    assert.equal(
      bundleClaimConfirmationSchema.safeParse({ ...base, phone }).success,
      false,
    );
  }
  assert.equal(normalizeTaiwanMobilePhone("0912-345-678"), "0912345678");
});

test("open orders derive an expired state without changing terminal states", () => {
  const now = new Date("2026-10-05T12:00:00.000Z");
  assert.equal(
    deriveBundleClaimStatus("open", "2026-10-05T11:59:59.000Z", now),
    "expired",
  );
  assert.equal(
    deriveBundleClaimStatus("open", "2026-10-05T12:00:01.000Z", now),
    "open",
  );
  assert.equal(
    deriveBundleClaimStatus("confirmed", "2026-10-05T11:59:59.000Z", now),
    "confirmed",
  );
});

test("evidence and lifecycle helpers reject impossible actions", () => {
  assert.equal(canEditBundleClaimEvidence("draft"), true);
  assert.equal(canEditBundleClaimEvidence("open"), false);
  assert.equal(canDeleteBundleClaim("draft"), true);
  assert.equal(canDeleteBundleClaim("confirmed"), false);
  assert.equal(canRecordBundleClaimPayment("confirmed", false), true);
  assert.equal(canRecordBundleClaimPayment("confirmed", true), false);
  assert.equal(canRecordBundleClaimPayment("open", false), false);
  assert.equal(canSetBundleClaimOutbound("confirmed", "2026-10-05"), true);
  assert.equal(canSetBundleClaimOutbound("confirmed"), false);
});

test("inventory access rejects a staff request for another inventory", () => {
  const otherOwnerId = "00000000-0000-4000-8000-000000000099";
  assert.equal(canAccessBundleClaimOwner("staff", OWNER_ID, OWNER_ID), true);
  assert.equal(
    canAccessBundleClaimOwner("staff", OWNER_ID, otherOwnerId),
    false,
  );
  assert.equal(
    canAccessBundleClaimOwner("admin", OWNER_ID, otherOwnerId),
    true,
  );
});

test("screenshot validation enforces supported MIME types and eight MB", () => {
  assert.equal(
    validateBundleClaimImage({ type: "image/jpeg", size: 8 * 1024 * 1024 }),
    undefined,
  );
  assert.match(
    validateBundleClaimImage({ type: "image/gif", size: 100 }) ?? "",
    /JPG/,
  );
  assert.match(
    validateBundleClaimImage({
      type: "image/png",
      size: 8 * 1024 * 1024 + 1,
    }) ?? "",
    /8MB/,
  );
});

test("money formatting handles integer and decimal amounts with commas", () => {
  assert.equal(formatBundleClaimMoney(1200), "$1,200");
  assert.equal(formatBundleClaimMoney(1200.5), "$1,200.50");
  assert.equal(formatBundleClaimMoney(0), "$0");
  assert.equal(formatBundleClaimMoney(1000000), "$1,000,000");
});

test("query schema validates supported filter categories and trims search", () => {
  const parsed = bundleClaimQuerySchema.safeParse({
    ownerId: OWNER_ID,
    filter: "confirmed_unpaid",
    search: "  海報  ",
  });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.filter, "confirmed_unpaid");
    assert.equal(parsed.data.search, "海報");
  }

  assert.equal(
    bundleClaimQuerySchema.safeParse({
      ownerId: OWNER_ID,
      filter: "invalid_status",
    }).success,
    false,
  );
});

test("end-to-end lifecycle helpers guarantee ordered operational transitions", () => {
  // 1. Draft phase
  let status = deriveBundleClaimStatus("draft");
  assert.equal(status, "draft");
  assert.equal(canEditBundleClaimEvidence(status), true);
  assert.equal(canDeleteBundleClaim(status), true);
  assert.equal(canRecordBundleClaimPayment(status, false), false);
  assert.equal(canSetBundleClaimOutbound(status), false);

  // 2. Open phase
  status = deriveBundleClaimStatus("open");
  assert.equal(status, "open");
  assert.equal(canEditBundleClaimEvidence(status), false);
  assert.equal(canDeleteBundleClaim(status), false);
  assert.equal(canRecordBundleClaimPayment(status, false), false);

  // 3. Confirmed & Unpaid phase
  status = deriveBundleClaimStatus("confirmed");
  assert.equal(status, "confirmed");
  assert.equal(canEditBundleClaimEvidence(status), false);
  assert.equal(canDeleteBundleClaim(status), false);
  assert.equal(canRecordBundleClaimPayment(status, false), true);
  // Cannot outbound before receiving
  assert.equal(canSetBundleClaimOutbound(status), false);

  // 4. Receiving checked phase
  assert.equal(canSetBundleClaimOutbound(status, "2026-10-05T12:00:00Z"), true);

  // 5. Confirmed & Paid phase
  assert.equal(canRecordBundleClaimPayment(status, true), false);

  // 6. Revoked / Cancelled phase
  status = deriveBundleClaimStatus("cancelled");
  assert.equal(canEditBundleClaimEvidence(status), false);
  assert.equal(canDeleteBundleClaim(status), false);
  assert.equal(canRecordBundleClaimPayment(status, false), false);
});
