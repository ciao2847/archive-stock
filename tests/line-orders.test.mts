import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildOrderReply,
  createOrderSession,
  extractOrderPhone,
  parseOrderAction,
  readOrderSession,
  requestedOrderView,
  type LineOrder,
  type LineOrderSummary,
} from "../src/lib/line-orders.ts";
const channel = {
  inventoryId: "00000000-0000-4000-8000-000000000001",
  channelSecret: "secret",
  channelAccessToken: "token",
};
const phone = "0987654321";
const pending: LineOrder = {
  form_title: "預購商品",
  confirmation_code: "P1",
  payment_status: "pending",
  paid_amount: 0,
  outstanding_amount: 300,
  created_at: "2026-10-14T01:00:00Z",
  items: [{ name: "海報", quantity: 1, unit_price: 300, subtotal: 300 }],
};
const partial: LineOrder = {
  ...pending,
  form_title: "部分付款商品",
  confirmation_code: "H1",
  payment_status: "half_paid",
  paid_amount: 100,
  outstanding_amount: 200,
};
const paid: LineOrder = {
  ...pending,
  form_title: "已付商品",
  confirmation_code: "F1",
  payment_status: "paid",
  paid_amount: 300,
  outstanding_amount: 0,
};
const summary: LineOrderSummary = {
  valid: true,
  found: true,
  phone,
  nickname: "小明",
  store_name: "小天地",
  completion_message: "喊單完畢請➕官方賴 ID：@xhs4077g 匯款才算訂購完成",
  submissions: [pending, partial, paid],
  transfer_account: {
    enabled: true,
    bank_code: "004",
    bank_name: "銀行",
    account: "111111",
  },
};
const text = (
  data = summary,
  view: "summary" | "paid" | "unpaid" | "all" = "summary",
  page = 0,
) =>
  buildOrderReply(data, phone, view, page, "session")
    .map((x) => x.text)
    .join("");
test("summary includes paid orders and only outstanding balances in unpaid total", () => {
  assert.match(text(), /未結帳：2 筆，尚需支付 \$500/);
  assert.match(text(), /已結帳：1 筆，已付清 \$300/);
  assert.doesNotMatch(text(), /111111/);
  assert.deepEqual(
    buildOrderReply(
      summary,
      phone,
      "summary",
      0,
      "session",
    )[0].quickReply?.items.map((x) => x.action.label),
    ["未結帳", "已結帳", "全部訂單"],
  );
});
test("unpaid includes partial payments while paid and all views omit bank details", () => {
  const unpaid = text(summary, "unpaid");
  assert.match(unpaid, /P1/);
  assert.match(unpaid, /H1/);
  assert.match(unpaid, /已付：\$100｜尚欠：\$200/);
  assert.match(unpaid, /111111/);
  assert.doesNotMatch(unpaid, /喊單完畢|@xhs4077g|匯款才算訂購完成/);
  assert.match(unpaid, /匯款完成後請回傳帳號末五碼/);
  assert.doesNotMatch(unpaid, /F1/);
  assert.match(text(summary, "paid"), /F1/);
  assert.doesNotMatch(text(summary, "paid"), /P1|H1|111111/);
  assert.match(text(summary, "paid"), /不代表已出貨/);
  assert.match(text(summary, "all"), /P1/);
  assert.match(text(summary, "all"), /F1/);
  assert.doesNotMatch(text(summary, "all"), /111111/);
});
test("five orders per page sorted newest first; empty and missing records are explicit", () => {
  const data = {
    ...summary,
    submissions: Array.from({ length: 7 }, (_, i) => ({
      ...paid,
      confirmation_code: `ORDER-${i}`,
      created_at: `2026-10-${String(i + 1).padStart(2, "0")}T01:00:00Z`,
    })),
  };
  assert.equal((text(data, "paid").match(/確認編號/g) || []).length, 5);
  assert.match(text(data, "paid"), /ORDER-6/);
  assert.doesNotMatch(text(data, "paid"), /ORDER-1/);
  const page = buildOrderReply(data, phone, "paid", 1, "session");
  assert.equal((page[0].text.match(/確認編號/g) || []).length, 2);
  assert.match(page[0].text, /ORDER-0/);
  assert.equal(
    page[0].quickReply?.items.some((x) => x.action.label === "下一頁"),
    false,
  );
  assert.match(
    text({ ...summary, submissions: [paid] }, "unpaid"),
    /目前沒有未結帳訂單/,
  );
  assert.match(
    text({ ...summary, submissions: [pending] }, "paid"),
    /目前沒有已結帳訂單/,
  );
  assert.match(text({ ...summary, found: false }), /查無手機號碼/);
});
test("encrypted query session expires and cannot cross LINE users or inventories", () => {
  const now = 10_000;
  const token = createOrderSession(phone, "user-a", channel, now);
  assert.equal(readOrderSession(token, "user-a", channel, now), phone);
  assert.equal(readOrderSession(token, "user-b", channel, now), undefined);
  assert.equal(
    readOrderSession(
      token,
      "user-a",
      { ...channel, inventoryId: "other" },
      now,
    ),
    undefined,
  );
  assert.equal(
    readOrderSession(
      token,
      "user-a",
      { ...channel, channelSecret: "changed" },
      now,
    ),
    undefined,
  );
  assert.equal(
    readOrderSession(token, "user-a", channel, now + 30 * 60 * 1000),
    undefined,
  );
  assert.equal(
    readOrderSession(
      (token[0] === "A" ? "B" : "A") + token.slice(1),
      "user-a",
      channel,
      now,
    ),
    undefined,
  );
  const reply = buildOrderReply(summary, phone, "all", 0, token);
  for (const button of reply[0].quickReply!.items) {
    assert.ok(button.action.data.length <= 300);
    assert.ok(!button.action.data.includes(phone));
    assert.equal(parseOrderAction(button.action.data)?.session, token);
  }
  for (const data of [
    "action=orders&view=other&page=0&session=x",
    "action=orders&view=paid&page=-1&session=x",
    "action=orders&view=paid&page=NaN&session=x",
  ])
    assert.equal(parseOrderAction(data), undefined);
});
test("phone validation rejects partial matches and recognizes requested categories", () => {
  for (const value of [
    phone,
    "查詢 " + phone,
    "0987-654-321",
    "0987 654 321",
    "0912345678",
  ])
    assert.ok(extractOrderPhone(value));
  for (const value of ["098765432", "09876543210", "10987654321", "1234567890"])
    assert.equal(extractOrderPhone(value), undefined);
  assert.equal(requestedOrderView("未結帳"), "unpaid");
  assert.equal(requestedOrderView("已結帳"), "paid");
  assert.equal(requestedOrderView("全部訂單"), "all");
});
test("large replies stay within LINE message limits", () => {
  const data = {
    ...summary,
    submissions: Array.from({ length: 5 }, () => ({
      ...pending,
      items: Array.from({ length: 500 }, () => ({
        name: "海報".repeat(100),
        quantity: 1,
        unit_price: 300,
        subtotal: 300,
      })),
    })),
  };
  const reply = buildOrderReply(data, phone, "all", 0, "session");
  assert.ok(reply.length <= 5);
  assert.ok(reply.every((message) => message.text.length <= 5000));
  assert.match(reply.at(-1)!.text, /未完整顯示/);
  assert.ok(reply.at(-1)!.quickReply);
});
