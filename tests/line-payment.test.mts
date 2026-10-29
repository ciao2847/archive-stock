import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePaymentReport } from "../src/lib/line-payment.ts";

const confirmation =
  "您好，我已完成訂購，確認編號：HD-5CA5B36734，電話：0987654321，請協助核對，謝謝。";

test("explicit payment references take priority over order codes and phones", () => {
  for (const label of ["我的末五碼", "末5碼", "後五碼", "後5碼"]) {
    assert.deepEqual(parsePaymentReport(`${confirmation}\n${label}：91154`), {
      lastFive: "91154",
    });
  }
  assert.deepEqual(parsePaymentReport("已匯款 12345，我的末五碼：91154"), {
    lastFive: "91154",
  });
  assert.deepEqual(
    parsePaymentReport(`${confirmation}\n我的末五碼：００１２３`),
    {
      lastFive: "00123",
    },
  );
});

test("empty, invalid and ambiguous labels never fall back to unrelated digits", () => {
  for (const suffix of [
    "請填寫末五碼",
    "末五碼：",
    "末五碼：1234",
    "末五碼：123456",
    "末五碼：HD-36734",
    "末五碼：0987654321",
    "末五碼：12345ABC",
    "末五碼：12345，後五碼：91154",
  ]) {
    assert.deepEqual(
      parsePaymentReport(`${confirmation}\n${suffix}`),
      {
        lastFive: null,
      },
      suffix,
    );
  }
  assert.deepEqual(parsePaymentReport("末五碼：00123，後五碼：00123"), {
    lastFive: "00123",
  });
});

test("plain five digits and short payment reports still work", () => {
  for (const text of [
    "00123",
    "已匯款 00123",
    "已轉帳：00123",
    "匯款完成\n00123",
    "末五碼為「00123」",
    "我的末五碼是：00123",
  ]) {
    assert.deepEqual(parsePaymentReport(text), { lastFive: "00123" }, text);
  }
  assert.deepEqual(parsePaymentReport(`已匯款\n${confirmation}`), {
    lastFive: null,
  });
  for (const text of [confirmation, "結帳與查詢", "0987654321"]) {
    assert.equal(parsePaymentReport(text), null);
  }
});
