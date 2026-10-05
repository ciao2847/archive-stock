import { createHmac } from "crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

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
      lines.push(`  （註：此單已付部分款項）`);
    }
  }

  lines.push("----------------------");
  lines.push(`共 ${data.unsettled_items_count} 件待結商品`);
  lines.push(`💰 待付總金額：$${data.unsettled_amount.toLocaleString()} 元`);

  const transferAccount =
    data.transfer_account?.enabled && data.transfer_account.account
      ? data.transfer_account
      : {
          enabled: true,
          bank_code: "824",
          bank_name: "連線商業銀行 (LINE Bank)",
          bank_branch: "",
          account: "111022318292",
          account_name: "",
        };

  if (transferAccount.enabled && transferAccount.account) {
    lines.push("");
    lines.push("🏦 匯款帳號資訊：");
    lines.push(
      `• 銀行：(${transferAccount.bank_code}) ${transferAccount.bank_name}${transferAccount.bank_branch ? ` ${transferAccount.bank_branch}` : ""}`,
    );
    lines.push(`• 帳號：${transferAccount.account}`);
    if (transferAccount.account_name) {
      lines.push(`• 戶名：${transferAccount.account_name}`);
    }
  }

  lines.push("");

  if (data.completion_message) {
    lines.push(data.completion_message);
  } else {
    lines.push(
      "匯款完成後請直接在此回傳「帳號末五碼」，小幫手會為您核對並標記結清，謝謝您！",
    );
  }

  return lines.join("\n");
}

export async function POST(request: Request) {
  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;

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

      const isInstructional = /請輸入|範例|例如|\(例[：:]|無卡匯款/i.test(userText);
      const isCheckoutIntent = /結帳|查詢|查單|對帳|買單|明細|結算|訂單/i.test(userText);
      const isPaymentReportIntent = /末[五5]碼|後[五5]碼|已匯款|匯款完成|已轉帳/i.test(userText);
      const isBankInfoIntent = /匯款|轉帳|帳號|銀行|代碼|戶名/i.test(userText);
      const isCustomerServiceIntent = /人工|客服|真人/i.test(userText);
      const isFormSubmitIntent = /確認編號|已完成.*喊單/i.test(userText);

      // Check if user input contains a Taiwan mobile number (09xxxxxxxx)
      const phoneMatch = userText.match(/09\d{2}[-\s]?\d{3}[-\s]?\d{3}|09\d{8}/);
      const matchedPhone = phoneMatch ? phoneMatch[0].replace(/\D/g, "") : null;
      const isDummyPhone = matchedPhone === "0912345678" || matchedPhone === "0900000000";

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
        const reportReply = [
          "已收到您的匯款回報！🙌",
          "小幫手會盡快為您核對並在系統標記結清，感謝您的配合與支持！",
        ].join("\n");
        await sendLineReply(event.replyToken, reportReply, channelAccessToken);
        continue;
      }

      // 3. Bank / Remittance info inquiry
      if (isBankInfoIntent && !matchedPhone) {
        const bankReply = [
          "🏦 海報小天地 匯款帳號資訊：",
          "• 銀行：(824) 連線商業銀行 (LINE Bank)",
          "• 帳號：111022318292",
          "",
          "如需查詢待結帳明細，請直接在此輸入您的「10 碼手機號碼」！",
          "匯款完成後請在此回傳「帳號末五碼」，小幫手會為您核對，謝謝您！",
          "（無卡匯款請洽主理人索取資訊）",
        ].join("\n");
        await sendLineReply(event.replyToken, bankReply, channelAccessToken);
        continue;
      }

      // 4. Instructional prompt, checkout intent without phone, or dummy phone
      if (isInstructional || (isCheckoutIntent && (!matchedPhone || isDummyPhone)) || (matchedPhone && isDummyPhone)) {
        const checkoutPrompt = [
          "🔍 結帳與明細查詢",
          "請直接在此輸入您填單登記的「10 碼手機號碼」（例如：09xxxxxxxx），系統將為您整理待付明細！",
          "",
          "🏦 匯款帳號資訊：",
          "• 銀行：(824) 連線商業銀行 (LINE Bank)",
          "• 帳號：111022318292",
          "（無卡匯款請洽主理人索取資訊）",
          "",
          "匯款完成後請在此回傳「帳號末五碼」，小幫手會為您核對並標記結清，謝謝您！",
        ].join("\n");
        await sendLineReply(event.replyToken, checkoutPrompt, channelAccessToken);
        continue;
      }

      // 5. Form submit confirmation text without matched phone
      if (isFormSubmitIntent && !matchedPhone) {
        const formSubmitPrompt = [
          "已收到您的喊單登記！🙌",
          "如需查詢待結帳明細，請輸入填單的「10 碼手機號碼」（例：0912345678）。",
          "",
          "🏦 匯款帳號資訊：",
          "• 銀行：(824) 連線商業銀行 (LINE Bank)",
          "• 帳號：111022318292",
          "（無卡匯款請洽主理人索取資訊）",
          "",
          "您也可以隨時點選下方選單查看相關功能！",
        ].join("\n");
        await sendLineReply(event.replyToken, formSubmitPrompt, channelAccessToken);
        continue;
      }

      if (matchedPhone) {
        try {
          const supabase = await createClient();
          const { data, error } = await supabase.rpc(
            "query_customer_claims_summary",
            { p_phone: matchedPhone },
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
