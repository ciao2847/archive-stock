import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import type { LineChannel } from "./line-channels.ts";

export type OrderView = "summary" | "unpaid" | "paid" | "all";
export type LineOrder = {
  source_type?: "claim" | "bundle";
  form_title: string;
  description?: string | null;
  confirmation_code: string;
  payment_status: "pending" | "half_paid" | "paid";
  paid_amount: number;
  outstanding_amount: number;
  created_at: string;
  items: Array<{
    name: string;
    quantity: number;
    unit_price: number;
    subtotal: number;
  }>;
};
export type LineOrderSummary = {
  valid: boolean;
  found: boolean;
  phone: string;
  nickname: string;
  store_name: string;
  completion_message: string;
  submissions: LineOrder[];
  transfer_account?: {
    enabled: boolean;
    bank_code: string;
    bank_name: string;
    bank_branch?: string;
    account: string;
  } | null;
};
export type LineTextMessage = {
  type: "text";
  text: string;
  quickReply?: {
    items: Array<{
      type: "action";
      action: {
        type: "postback";
        label: string;
        displayText: string;
        data: string;
      };
    }>;
  };
};
export const PHONE_PROMPT =
  "請輸入訂購時填寫的 10 碼手機號碼，例如：0987654321。\n\n可查詢：\n🟠 未結帳訂單與待付金額\n🟢 已結帳訂單與商品明細";
export const INVALID_PHONE =
  "手機號碼需為 09 開頭的 10 位數字，請確認後重新輸入。";
const SESSION_MS = 30 * 60 * 1000;
const PAGE_SIZE = 5;
const titles = {
  summary: "訂單查詢",
  unpaid: "未結帳訂單",
  paid: "已結帳訂單",
  all: "全部訂單",
};
const money = (value: number) =>
  `$${value.toLocaleString("zh-TW", { maximumFractionDigits: 2 })}`;
const total = (order: LineOrder) =>
  order.items.reduce((sum, item) => sum + item.subtotal, 0);
export const isPaidOrder = (order: LineOrder) =>
  order.payment_status === "paid" || order.outstanding_amount === 0;
const key = (channel: LineChannel) =>
  createHash("sha256")
    .update(
      `line-order-query:v1:${channel.inventoryId}:${channel.channelSecret}`,
    )
    .digest();

// Keep the phone out of postback URLs. The authenticated encryption binds the
// short-lived query to this LINE user and inventory, without a process cache.
export function createOrderSession(
  phone: string,
  userId: string,
  channel: LineChannel,
  now = Date.now(),
) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(channel), iv);
  cipher.setAAD(Buffer.from(userId));
  const body = Buffer.concat([
    cipher.update(JSON.stringify([phone, now + SESSION_MS]), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}
export function readOrderSession(
  token: string,
  userId: string,
  channel: LineChannel,
  now = Date.now(),
): string | undefined {
  try {
    if (!userId || !/^[A-Za-z0-9_-]{40,180}$/.test(token)) return;
    const data = Buffer.from(token, "base64url");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key(channel),
      data.subarray(0, 12),
    );
    decipher.setAAD(Buffer.from(userId));
    decipher.setAuthTag(data.subarray(12, 28));
    const [phone, expires] = JSON.parse(
      Buffer.concat([
        decipher.update(data.subarray(28)),
        decipher.final(),
      ]).toString("utf8"),
    );
    if (
      typeof phone !== "string" ||
      !/^09\d{8}$/.test(phone) ||
      typeof expires !== "number" ||
      expires <= now ||
      expires > now + SESSION_MS
    )
      return;
    return phone;
  } catch {
    return;
  }
}
export function parseOrderAction(data: string) {
  if (data.length > 300) return;
  const params = new URLSearchParams(data);
  if (params.get("action") !== "orders") return;
  const view = params.get("view");
  const page = params.get("page");
  const session = params.get("session");
  if (
    !view ||
    !["summary", "unpaid", "paid", "all"].includes(view) ||
    !page ||
    !/^\d{1,6}$/.test(page) ||
    !session
  )
    return;
  return { view: view as OrderView, page: Number(page), session };
}
export function extractOrderPhone(text: string) {
  return text
    .match(/(?<!\d)09\d{2}[-\s]?\d{3}[-\s]?\d{3}(?!\d)/)?.[0]
    .replace(/\D/g, "");
}
export function requestedOrderView(text: string): OrderView {
  if (/未結帳|未付款|待付/.test(text)) return "unpaid";
  if (/已結帳|已付款|已付清/.test(text)) return "paid";
  if (/全部訂單|所有訂單/.test(text)) return "all";
  return "summary";
}
function splitMessages(text: string): LineTextMessage[] {
  // LINE allows at most five messages, 5,000 UTF-16 units per text message.
  if (text.length > 23_500)
    text =
      text.slice(0, 23_300) +
      "\n\n明細較多，未完整顯示的內容請留言聯繫管理者查詢。";
  const messages: LineTextMessage[] = [];
  while (text.length) {
    let end = Math.min(4800, text.length);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    messages.push({ type: "text", text: text.slice(0, end) });
    text = text.slice(end);
  }
  return messages;
}
export function buildOrderReply(
  data: LineOrderSummary,
  phone: string,
  view: OrderView,
  requestedPage: number,
  session?: string,
): LineTextMessage[] {
  if (!data.valid)
    return [
      {
        type: "text",
        text: "系統設定尚未完成，請直接留言聯繫管理者。",
      },
    ];
  if (!data.found)
    return [
      {
        type: "text",
        text: `查無手機號碼「${phone}」的訂購紀錄，請確認是否與訂購時填寫的號碼相同。`,
      },
    ];
  const orders = [...data.submissions].sort(
    (a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0),
  );
  const unpaid = orders.filter((order) => !isPaidOrder(order));
  const paid = orders.filter(isPaidOrder);
  const filtered = view === "unpaid" ? unpaid : view === "paid" ? paid : orders;
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(Math.max(0, requestedPage), pageCount - 1);
  const lines = [`${data.nickname || "買家"}您好！`, `手機：${phone}`, ""];
  if (view === "summary") {
    lines.push(
      `🟠 未結帳：${unpaid.length} 筆，尚需支付 ${money(unpaid.reduce((sum, order) => sum + order.outstanding_amount, 0))}`,
      `🟢 已結帳：${paid.length} 筆，已付清 ${money(paid.reduce((sum, order) => sum + total(order), 0))}`,
      "",
      "請選擇下方按鈕查看訂單。",
      "已結帳代表款項已付清，不代表已出貨。",
    );
  } else if (!filtered.length) {
    lines.push(`目前沒有${titles[view]}。`);
  } else {
    for (const order of filtered.slice(
      page * PAGE_SIZE,
      (page + 1) * PAGE_SIZE,
    )) {
      const status = isPaidOrder(order)
        ? "🟢 已結帳"
        : order.paid_amount > 0
          ? "🟠 部分付款"
          : "🟠 未付款";
      lines.push(
        `${status}｜${order.form_title}`,
        `確認編號：${order.confirmation_code}`,
      );
      if (Number.isFinite(Date.parse(order.created_at)))
        lines.push(
          `訂購日期：${new Date(order.created_at).toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" })}`,
        );
      if (order.source_type === "bundle" && order.description)
        lines.push(
          `說明：${order.description.replace(/\s+/g, " ").slice(0, 160)}`,
        );
      for (const item of order.items)
        lines.push(
          `・${item.name} × ${item.quantity}（${money(item.subtotal)}）`,
        );
      lines.push(`訂單金額：${money(total(order))}`);
      if (!isPaidOrder(order))
        lines.push(
          `已付：${money(order.paid_amount)}｜尚欠：${money(order.outstanding_amount)}`,
        );
      lines.push("");
    }
    if (view === "unpaid") {
      lines.push(
        `全部未結帳訂單尚需支付：${money(unpaid.reduce((sum, order) => sum + order.outstanding_amount, 0))}`,
      );
      const bank = data.transfer_account;
      if (bank?.enabled && bank.account)
        lines.push(
          "",
          "🏦 匯款資訊：",
          `銀行：(${bank.bank_code}) ${bank.bank_name}${bank.bank_branch ? ` ${bank.bank_branch}` : ""}`,
          `帳號：${bank.account}`,
        );
      else lines.push("", "此庫藏尚未設定匯款帳號，請留言聯繫管理者。");
      lines.push(
        "",
        "匯款完成後請回傳帳號末五碼，由管理者核對後登記付款狀態。",
      );
    } else if (view === "paid")
      lines.push("已結帳代表款項已付清，不代表已出貨。");
  }
  if (!session)
    lines.push("", "也可輸入「未結帳／已結帳／全部訂單＋手機號碼」查詢。");
  const messages = splitMessages(lines.join("\n"));
  if (session) {
    const buttons: Array<{ label: string; view: OrderView; page: number }> = [
      { label: "未結帳", view: "unpaid", page: 0 },
      { label: "已結帳", view: "paid", page: 0 },
      { label: "全部訂單", view: "all", page: 0 },
    ];
    if (view !== "summary" && page > 0)
      buttons.push({ label: "上一頁", view, page: page - 1 });
    if (view !== "summary" && page + 1 < pageCount)
      buttons.push({ label: "下一頁", view, page: page + 1 });
    messages[messages.length - 1].quickReply = {
      items: buttons.map((button) => ({
        type: "action",
        action: {
          type: "postback",
          label: button.label,
          displayText: button.label,
          data: new URLSearchParams({
            action: "orders",
            view: button.view,
            page: String(button.page),
            session,
          }).toString(),
        },
      })),
    };
  }
  return messages;
}
