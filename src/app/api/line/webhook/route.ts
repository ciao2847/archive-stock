import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { getLineChannels, resolveLineChannel } from "@/lib/line-channels";
import { parsePaymentReport } from "@/lib/line-payment";
import {
  buildOrderReply,
  createOrderSession,
  extractOrderPhone,
  INVALID_PHONE,
  parseOrderAction,
  PHONE_PROMPT,
  readOrderSession,
  requestedOrderView,
  type LineOrderSummary,
  type LineTextMessage,
  type OrderView,
} from "@/lib/line-orders";

interface LineMessageEvent {
  type: string;
  replyToken?: string;
  message?: {
    id: string;
    type: string;
    text?: string;
  };
  postback?: { data?: string };
  source?: {
    type: string;
    userId?: string;
  };
}

async function sendLineReply(
  replyToken: string,
  content: string | LineTextMessage[],
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
      messages:
        typeof content === "string"
          ? [{ type: "text", text: content }]
          : content,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error("LINE reply API error:", response.status, errorBody);
  }
}

export async function POST(request: Request) {
  let channels;
  try {
    channels = getLineChannels();
  } catch (error) {
    console.error(
      "LINE webhook channel configuration is missing or invalid:",
      error instanceof Error ? error.message : "Unknown configuration error",
    );
    return NextResponse.json(
      { error: "LINE configuration unavailable" },
      { status: 503 },
    );
  }
  const rawBody = await request.text();
  const channel = resolveLineChannel(
    rawBody,
    request.headers.get("x-line-signature"),
    channels,
  );
  if (!channel) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }
  const { inventoryId: lineInventoryId, channelAccessToken } = channel;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  let body: { events?: LineMessageEvent[] };
  try {
    body = JSON.parse(rawBody);
    if (!body || typeof body !== "object" || !Array.isArray(body.events)) {
      return NextResponse.json({ error: "Invalid events" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  async function queryOrders(
    event: LineMessageEvent,
    phone: string,
    view: OrderView,
    page = 0,
    session?: string,
  ) {
    if (!supabaseUrl || !supabaseSecretKey) {
      await sendLineReply(
        event.replyToken!,
        "系統設定尚未完成，請直接留言聯繫管理者。",
        channelAccessToken,
      );
      return;
    }
    try {
      const supabase = createClient<Database>(supabaseUrl, supabaseSecretKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { data, error } = await supabase.rpc(
        "query_customer_claims_summary",
        { p_inventory_id: lineInventoryId, p_phone: phone },
      );
      if (error || !data) {
        console.error("LINE order lookup failed", {
          inventoryId: lineInventoryId,
          code: error?.code,
        });
        await sendLineReply(
          event.replyToken!,
          "系統查詢暫時忙碌中，請稍候再試或留言聯繫管理者。",
          channelAccessToken,
        );
        return;
      }
      const nextSession =
        session ||
        (event.source?.userId
          ? createOrderSession(phone, event.source.userId, channel!)
          : undefined);
      await sendLineReply(
        event.replyToken!,
        buildOrderReply(
          data as unknown as LineOrderSummary,
          phone,
          view,
          page,
          nextSession,
        ),
        channelAccessToken,
      );
    } catch {
      console.error("LINE order lookup could not be completed", {
        inventoryId: lineInventoryId,
      });
      await sendLineReply(
        event.replyToken!,
        "查詢失敗，請稍候再試或留言聯繫管理者。",
        channelAccessToken,
      );
    }
  }

  for (const event of body.events ?? []) {
    if (!event || typeof event.replyToken !== "string" || !event.replyToken)
      continue;
    if (event.type === "postback" && typeof event.postback?.data === "string") {
      const action = parseOrderAction(event.postback.data);
      if (!action) continue;
      const phone = readOrderSession(
        action.session,
        event.source?.userId || "",
        channel,
      );
      if (!phone) {
        await sendLineReply(
          event.replyToken,
          `查詢已逾時或無法使用，請重新輸入手機號碼。\n\n${PHONE_PROMPT}`,
          channelAccessToken,
        );
        continue;
      }
      await queryOrders(event, phone, action.view, action.page, action.session);
      continue;
    }
    if (
      event.type !== "message" ||
      event.message?.type !== "text" ||
      typeof event.message.text !== "string"
    )
      continue;
    const text = event.message.text.trim();
    const paymentReport = parsePaymentReport(text);
    if (paymentReport) {
      const { lastFive } = paymentReport;
      await sendLineReply(
        event.replyToken,
        lastFive
          ? `已收到匯款帳號末五碼「${lastFive}」！\n管理者核對金額與明細後，會在系統登記付款狀態；此回覆不代表已完成對帳。`
          : "請回傳匯款帳號的末五碼（共 5 位數字），方便管理者核對款項。",
        channelAccessToken,
      );
      continue;
    }
    const phone = extractOrderPhone(text);
    if (phone) {
      await queryOrders(event, phone, requestedOrderView(text));
      continue;
    }
    const isQuery = text === "結帳與查詢";
    // A malformed phone should receive guidance rather than disappear. Five
    // digits were already handled above as a payment reference.
    const looksLikePhone =
      /(?:\d[-\s]*){6,}/.test(text) || /^[\d\s-]+$/.test(text);
    if (looksLikePhone) {
      await sendLineReply(event.replyToken, INVALID_PHONE, channelAccessToken);
    } else if (isQuery) {
      await sendLineReply(event.replyToken, PHONE_PROMPT, channelAccessToken);
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
