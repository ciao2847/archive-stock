import { createHmac } from "crypto";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

interface LineMessageEvent {
  type: string;
  replyToken?: string;
  message?: {
    id: string;
    type: string;
    text?: string;
  };
  source?: {
    type: string;
    userId?: string;
  };
}

interface CustomerClaimsSummaryResult {
  valid: boolean;
  found: boolean;
  phone: string;
  nickname: string;
  store_name: string;
  official_line_id: string;
  completion_message: string;
  transfer_account?: {
    enabled: boolean;
    bank_code: string;
    bank_name: string;
    bank_branch?: string;
    account: string;
    account_name: string;
  } | null;
  unsettled_amount: number;
  unsettled_items_count: number;
  total_amount: number;
  total_items_count: number;
  all_paid: boolean;
  submissions: Array<{
    form_title: string;
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
  }>;
}

function verifySignature(
  body: string,
  signature: string | null,
  channelSecret: string,
): boolean {
  if (!signature) return false;
  const hash = createHmac("sha256", channelSecret)
    .update(body)
    .digest("base64");
  return hash === signature;
}

async function sendLineReply(
  replyToken: string,
  text: string,
  accessToken: string,
) {
  // LINE verification events use a dummy replyToken of all zeroes
  if (replyToken.startsWith("00000000000000000000000000000000")) {
    return;
  }

  const response = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: "text", text }],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error("LINE reply API error:", response.status, errorBody);
  }
}

function formatCustomerClaimsMessage(
  data: CustomerClaimsSummaryResult,
  phone: string,
): string {
  if (!data.valid) {
    return "系統設定尚未完成，請輸入「人工客服」聯繫小幫手。";
  }

  if (!data.found) {
    return `查無電話「${phone}」的喊單紀錄。\n請確認號碼是否與填單時填寫的手機號碼一致，謝謝您！`;
  }

  if (data.all_paid) {
    return `${data.nickname ? `${data.nickname} ` : ""}您好！\n目前查無尚未結帳的喊單，您在「${data.store_name}」的款項皆已結清，感謝您的支持！`;
  }

  const unsettledSubmissions = data.submissions.filter(
    (sub) => sub.payment_status !== "paid",
  );

  const lines: string[] = [
    `【${data.store_name} 喊單待結帳明細】`,
    `顧客：${data.nickname || "買家"}`,
    `電話：${phone}`,
    "",
    "📦 尚未結帳品項：",
  ];

  for (const sub of unsettledSubmissions) {
    lines.push(`• ${sub.form_title}`);
    for (const item of sub.items) {
      lines.push(
        `  - ${item.name} × ${item.quantity}（$${item.subtotal.toLocaleString()}）`,
      );
    }
    if (sub.payment_status === "half_paid") {
      lines.push(
        `  （已付 $${sub.paid_amount.toLocaleString()}，尚待付 $${sub.outstanding_amount.toLocaleString()}）`,
      );
    }
  }

  lines.push("----------------------");
  lines.push(`共 ${data.unsettled_items_count} 件待結商品`);
  lines.push(`💰 待付總金額：$${data.unsettled_amount.toLocaleString()} 元`);

  const transferAccount = data.transfer_account;

  if (transferAccount?.enabled && transferAccount.account) {
    lines.push("");
    lines.push("🏦 匯款帳號資訊：");
    lines.push(
      `• 銀行：(${transferAccount.bank_code}) ${transferAccount.bank_name}${transferAccount.bank_branch ? ` ${transferAccount.bank_branch}` : ""}`,
    );
    lines.push(`• 帳號：${transferAccount.account}`);
    if (transferAccount.account_name) {
      lines.push(`• 戶名：${transferAccount.account_name}`);
    }
  } else {
    lines.push("");
    lines.push("🏦 匯款資料：");
    lines.push("此庫藏尚未設定匯款帳號，請輸入「人工客服」聯繫小幫手。");
  }

  lines.push("");

  if (data.completion_message) {
    lines.push(data.completion_message);
  } else {
    lines.push(
      "匯款完成後請回傳「帳號末五碼」，管理者核對後會在系統登記付款狀態。",
    );
  }

  return lines.join("\n");
}

export async function POST(request: Request) {
  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const lineInventoryId = process.env.LINE_INVENTORY_ID?.trim();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  const rawBody = await request.text();
  const signature = request.headers.get("x-line-signature");

  // Validate signature if secret is configured
  if (channelSecret) {
    const isValid = verifySignature(rawBody, signature, channelSecret);
    if (!isValid) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  }

  if (!channelAccessToken) {
    console.warn(
      "LINE_CHANNEL_ACCESS_TOKEN is not configured. Webhook received event but cannot reply.",
    );
    return NextResponse.json({ status: "token_missing" });
  }

  let body: { events?: LineMessageEvent[] };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const events = body.events ?? [];

  for (const event of events) {
    if (
      event.type === "message" &&
      event.message?.type === "text" &&
      event.replyToken
    ) {
      const userText = event.message.text?.trim() ?? "";

      const isInstructional =
        /請輸入.*(?:電話|手機)|(?:電話|手機).*(?:輸入|查詢)/i.test(userText);
      const isCheckoutIntent = /結帳|查詢|查單|對帳|買單|明細|結算|訂單/i.test(
        userText,
      );
      const isPaymentReportIntent =
        /^\d{5}$/.test(userText) ||
        /末[五5]碼|後[五5]碼|已匯款|匯款完成|已轉帳/i.test(userText);
      const isBankInfoIntent = /匯款|轉帳|帳號|銀行|代碼|戶名/i.test(userText);
      const isCustomerServiceIntent = /人工|客服|真人/i.test(userText);
      const isFormSubmitIntent = /確認編號|已完成.*喊單/i.test(userText);

      // Check if user input contains a Taiwan mobile number (09xxxxxxxx)
      const phoneMatch = userText.match(
        /09\d{2}[-\s]?\d{3}[-\s]?\d{3}|09\d{8}/,
      );
      const matchedPhone = phoneMatch ? phoneMatch[0].replace(/\D/g, "") : null;
      const isDummyPhone =
        matchedPhone === "0912345678" || matchedPhone === "0900000000";
      const paymentLastFive = isPaymentReportIntent
        ? (userText.match(/(?:^|\D)(\d{5})(?:\D|$)/)?.[1] ?? null)
        : null;

      const checkoutPrompt = [
        "🔍 結帳與明細查詢",
        "請輸入喊單時填寫的 10 碼手機號碼（09xxxxxxxx）。",
        "查詢成功後，系統會顯示尚未結帳明細與該庫藏的匯款資料。",
      ].join("\n");

      // 1. Customer service intent
      if (isCustomerServiceIntent) {
        const serviceReply = [
          "已為您通知小幫手！🙌",
          "小幫手正在趕來回覆的路上，請稍候片刻，我們會盡快為您服務 💪",
        ].join("\n");
        await sendLineReply(event.replyToken, serviceReply, channelAccessToken);
        continue;
      }

      // 2. Payment report intent (takes priority over general bank inquiry)
      if (isPaymentReportIntent) {
        const reportReply = paymentLastFive
          ? [
              `已收到匯款帳號末五碼「${paymentLastFive}」！🙌`,
              "管理者核對金額與明細後，會在系統登記付款狀態；此回覆不代表已完成對帳。",
            ].join("\n")
          : "請回傳匯款帳號的「末五碼」（共 5 位數字），方便管理者核對款項。";
        await sendLineReply(event.replyToken, reportReply, channelAccessToken);
        continue;
      }

      // A real phone number takes the user directly to the scoped lookup.
      if (matchedPhone && !isDummyPhone) {
        if (
          !lineInventoryId ||
          !supabaseUrl ||
          !supabaseSecretKey ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            lineInventoryId,
          )
        ) {
          console.error("LINE claim lookup configuration is missing or invalid");
          await sendLineReply(
            event.replyToken,
            "系統設定尚未完成，請輸入「人工客服」聯繫小幫手。",
            channelAccessToken,
          );
          continue;
        }

        try {
          const supabase = createClient<Database>(
            supabaseUrl,
            supabaseSecretKey,
            {
              auth: {
                autoRefreshToken: false,
                persistSession: false,
              },
            },
          );
          const { data, error } = await supabase.rpc(
            "query_customer_claims_summary",
            {
              p_inventory_id: lineInventoryId,
              p_phone: matchedPhone,
            },
          );

          if (error) {
            console.error("query_customer_claims_summary error:", error);
            await sendLineReply(
              event.replyToken,
              "系統查詢暫時忙碌中，請稍候再試或直接聯絡小幫手，謝謝！",
              channelAccessToken,
            );
            continue;
          }

          const replyText = formatCustomerClaimsMessage(
            data as unknown as CustomerClaimsSummaryResult,
            matchedPhone,
          );
          await sendLineReply(event.replyToken, replyText, channelAccessToken);
        } catch (queryErr) {
          console.error("Failed to query claims:", queryErr);
          await sendLineReply(
            event.replyToken,
            "查詢失敗，請稍候再試或聯絡小幫手。",
            channelAccessToken,
          );
        }
        continue;
      }

      // Intent messages only ask for a phone number. Account details are
      // returned after a successful, inventory-scoped lookup.
      if (
        isInstructional ||
        isCheckoutIntent ||
        isBankInfoIntent ||
        isFormSubmitIntent ||
        isDummyPhone
      ) {
        await sendLineReply(
          event.replyToken,
          checkoutPrompt,
          channelAccessToken,
        );
      }
    }
  }

  return NextResponse.json({ status: "ok" });
}

export async function GET() {
  return NextResponse.json({
    status: "ok",
    message: "LINE Webhook is running",
  });
}
