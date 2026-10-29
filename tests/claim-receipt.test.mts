import assert from "node:assert/strict";
import test from "node:test";
import {
  CLAIM_RECEIPT_RETENTION_MS,
  parseClaimReceipt,
  readClaimReceipt,
  saveClaimReceipt,
  clearClaimReceipt,
  type ClaimReceipt,
} from "../src/lib/claim-receipt.ts";

const now = Date.now();
const receipt: ClaimReceipt = {
  version: 1,
  formToken: "form-a",
  savedAt: now,
  form: { title: "測試訂購", completionMessage: "請完成匯款" },
  result: {
    confirmationCode: "HD-RECEIPT",
    submittedAt: new Date(now).toISOString(),
    transferAccount: {
      bankCode: "700",
      bankName: "測試銀行",
      account: "1234567890",
      accountName: "測試戶名",
    },
  },
  phone: "0912345678",
  items: [
    {
      product: { id: "product-1", name: "訂購當時的商品", price: 450 },
      quantity: 2,
    },
  ],
};

test("receipts preserve the submitted items, amounts and transfer account, scoped to the original form", () => {
  assert.deepEqual(
    parseClaimReceipt(JSON.stringify(receipt), "form-a", now),
    receipt,
  );
  assert.equal(parseClaimReceipt(JSON.stringify(receipt), "form-b", now), null);
});

test("expired, future and malformed receipts cannot replace the order form", () => {
  assert.equal(
    parseClaimReceipt(
      JSON.stringify(receipt),
      "form-a",
      now + CLAIM_RECEIPT_RETENTION_MS,
    ),
    null,
  );
  assert.equal(
    parseClaimReceipt(
      JSON.stringify({ ...receipt, savedAt: now + 120_000 }),
      "form-a",
      now,
    ),
    null,
  );
  assert.equal(parseClaimReceipt("{broken", "form-a", now), null);
  assert.equal(
    parseClaimReceipt(JSON.stringify({ ...receipt, items: [] }), "form-a", now),
    null,
  );
  assert.equal(
    parseClaimReceipt(
      JSON.stringify({
        ...receipt,
        items: [{ ...receipt.items[0], quantity: -1 }],
      }),
      "form-a",
      now,
    ),
    null,
  );
});

test("storage failures do not throw or lose the visible successful order; session storage can recover it", () => {
  const values = new Map<string, string>();
  const sessionStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  const browser = {
    get localStorage(): Storage {
      throw new Error("blocked");
    },
    sessionStorage,
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: browser,
  });
  try {
    assert.equal(saveClaimReceipt(receipt), true);
    assert.deepEqual(readClaimReceipt("form-a"), receipt);
    assert.equal(readClaimReceipt("form-b"), null);
    clearClaimReceipt("form-a");
    assert.equal(readClaimReceipt("form-a"), null);
    Object.defineProperty(browser, "sessionStorage", {
      get() {
        throw new Error("blocked");
      },
    });
    assert.equal(saveClaimReceipt(receipt), false);
    assert.equal(readClaimReceipt("form-a"), null);
    assert.doesNotThrow(() => clearClaimReceipt("form-a"));
  } finally {
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
