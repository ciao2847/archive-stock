import assert from "node:assert/strict";
import test from "node:test";

import {
  bundleClaimCampaignSchema,
  bundleClaimConfirmationSchema,
  bundleProductSchema,
  sumBundleProductAmounts,
  bundleMenuConfirmationSchema,
  toPublicBundleMenuOption,
  type BundleClaimOrder,
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
        customerHint: "james",
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

test("shared menu publishes only open non-expired and confirmed allocations", () => {
  const order = menuOrderFixture();
  assert.equal(toPublicBundleMenuOption(order)?.state, "open");
  assert.equal(
    toPublicBundleMenuOption({ ...order, status: "confirmed" })?.state,
    "confirmed",
  );
  for (const status of ["draft", "cancelled", "expired"] as const) {
    assert.equal(toPublicBundleMenuOption({ ...order, status }), null);
  }
  assert.equal(
    toPublicBundleMenuOption({ ...order, expiresAt: "2000-01-01T00:00:00Z" }),
    null,
  );
  assert.equal(
    toPublicBundleMenuOption({
      ...order,
      status: "confirmed",
      expiresAt: "2000-01-01T00:00:00Z",
    })?.state,
    "confirmed",
  );
});

test("shared menu never includes submitted contacts, private tokens, receipts or payments", () => {
  const option = toPublicBundleMenuOption(menuOrderFixture());
  assert.ok(option);
  assert.deepEqual(
    Object.keys(option).sort(),
    [
      "id",
      "label",
      "state",
      "title",
      "description",
      "totalAmount",
      "expiresAt",
      "images",
    ].sort(),
  );
  const serialized = JSON.stringify(option);
  for (const secret of [
    "secret-order-token",
    "secret-receipt",
    "0912345678",
    "private-customer-notes",
    "private-payment-note",
    "private-contact.jpg",
  ]) {
    assert.equal(serialized.includes(secret), false, secret);
  }
  assert.equal(option.images[0].originalFilename, "核對截圖 1");
});

test("shared menu labels use the preassigned hint rather than submitted nickname", () => {
  const order = menuOrderFixture();
  assert.equal(toPublicBundleMenuOption(order)?.label, "james");
  assert.equal(
    toPublicBundleMenuOption({ ...order, customerHint: "  " })?.label,
    order.title,
  );
});

test("shared menu confirmation requires a valid allocation and strips price overrides", () => {
  const input = {
    orderId: 1,
    nickname: "james",
    phone: "0912345678",
    consent: true,
    requestId: "00000000-0000-4000-8000-000000000002",
    turnstileToken: "verified-token",
    totalAmount: 1,
  };
  const valid = bundleMenuConfirmationSchema.safeParse(input);
  assert.equal(valid.success, true);
  if (valid.success) assert.equal("totalAmount" in valid.data, false);
  for (const orderId of [0, -1, 1.5, "1", undefined]) {
    assert.equal(
      bundleMenuConfirmationSchema.safeParse({ ...input, orderId }).success,
      false,
    );
  }
  assert.equal(
    bundleMenuConfirmationSchema.safeParse({ ...input, website: "bot" })
      .success,
    false,
  );
});

function menuOrderFixture(): BundleClaimOrder {
  return {
    id: 1,
    ownerId: OWNER_ID,
    publicToken: "secret-order-token",
    confirmationCode: "secret-receipt",
    title: "已配好的大禮包",
    customerHint: "james",
    description: "依截圖為準",
    totalAmount: 1200,
    status: "open",
    customerNickname: "different-submitted-name",
    customerPhone: "0912345678",
    customerNotes: "private-customer-notes",
    createdAt: "2026-10-05T00:00:00Z",
    updatedAt: "2026-10-05T00:00:00Z",
    images: [
      {
        id: 1,
        sortOrder: 0,
        mediaType: "image/jpeg",
        originalFilename: "private-contact.jpg",
        byteSize: 1024,
        url: "https://example.invalid/signed-image",
      },
    ],
    payment: {
      id: 1,
      amount: 1200,
      transferredAt: "2026-10-05T00:00:00Z",
      note: "private-payment-note",
      createdAt: "2026-10-05T00:00:00Z",
    },
  };
}

test("product names and prices are required and summed in integer cents", () => {
  assert.equal(sumBundleProductAmounts([0.1, 0.2, 450.25, 749.75]), 1200.3);
  assert.equal(
    bundleProductSchema.safeParse({ id: 1, name: "海報", amount: 450.25 })
      .success,
    true,
  );
  for (const amount of [0, -1, 0.001, Infinity]) {
    assert.equal(
      bundleProductSchema.safeParse({ id: 1, name: "海報", amount }).success,
      false,
    );
  }
  assert.equal(
    bundleProductSchema.safeParse({ id: 1, name: " ", amount: 1 }).success,
    false,
  );
});

test("campaign metadata validates names and defaults to unpublished", () => {
  const result = bundleClaimCampaignSchema.parse({
    ownerId: OWNER_ID,
    title: " 第一批 ",
    description: "說明",
  });
  assert.equal(result.title, "第一批");
  assert.equal(result.enabled, false);
  assert.equal(
    bundleClaimCampaignSchema.safeParse({ ownerId: OWNER_ID, title: " " })
      .success,
    false,
  );
  const draft = bundleClaimDraftSchema.parse({
    ownerId: OWNER_ID,
    campaignId: 12,
    title: "品項",
    customerHint: "james",
    totalAmount: 1888.25,
  });
  assert.equal(draft.campaignId, 12);
  assert.equal(draft.totalAmount, 1888.25);
  assert.equal(
    bundleClaimQuerySchema.parse({ ownerId: OWNER_ID, campaignId: "12" })
      .campaignId,
    12,
  );
  assert.equal(
    bundleClaimDraftSchema.safeParse({
      ownerId: OWNER_ID,
      campaignId: -1,
      title: "品項",
      customerHint: "james",
      totalAmount: 1,
    }).success,
    false,
  );
});

test("bundle draft requires a nonblank customer option name", () => {
  const input = {
    ownerId: OWNER_ID,
    title: "十月大禮包第一彈",
    totalAmount: 1399,
  };
  for (const customerHint of [undefined, "", "   "])
    assert.equal(
      bundleClaimDraftSchema.safeParse({ ...input, customerHint }).success,
      false,
    );
  const result = bundleClaimDraftSchema.parse({
    ...input,
    customerHint: " james ",
  });
  assert.equal(result.customerHint, "james");
});
