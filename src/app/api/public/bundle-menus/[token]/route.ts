import { z } from "zod";

import { apiFailure, apiSuccess, withApiErrorHandling } from "@/lib/api/server-auth";
import { fetchPublicBundleMenu } from "@/lib/api/public-bundle-menu";
import { fetchPublicBundleClaim } from "@/lib/api/public-bundle-claims";
import { bundleMenuConfirmationSchema } from "@/lib/bundle-claims";
import { getRequestIp, verifyClaimTurnstile } from "@/lib/turnstile";
import { createServiceClient } from "@/utils/supabase/service";

const tokenSchema = z.string().uuid();
type Context = { params: Promise<{ token: string }> };

export async function GET(_request: Request, { params }: Context) {
  return withApiErrorHandling("GET /api/public/bundle-menus/[token]", async () => {
    const token = tokenSchema.safeParse((await params).token);
    if (!token.success) return apiFailure("無法開啟共同選單", 404);
    const menu = await fetchPublicBundleMenu(token.data);
    return menu ? apiSuccess(menu) : apiFailure("無法開啟共同選單", 404);
  });
}

export async function POST(request: Request, { params }: Context) {
  return withApiErrorHandling("POST /api/public/bundle-menus/[token]", async () => {
    const token = tokenSchema.safeParse((await params).token);
    if (!token.success) return apiFailure("無法開啟共同選單", 404);
    if (request.headers.get("sec-fetch-site") === "cross-site") return apiFailure("無法從其他網站送出喊單", 403);
    const parsed = bundleMenuConfirmationSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return apiFailure(parsed.error.issues[0]?.message || "請確認填寫資料", 400);
    const input = parsed.data;
    const turnstile = await verifyClaimTurnstile({
      token: input.turnstileToken, expectedHostname: new URL(request.url).hostname,
      remoteIp: getRequestIp(request.headers), requestId: input.requestId,
    });
    if (!turnstile.ok) {
      const unavailable = turnstile.reason === "misconfigured" || turnstile.reason === "unavailable";
      return apiFailure(unavailable ? "安全驗證暫時無法使用，請稍後再試。" : "人機驗證已失效，請重新驗證。", unavailable ? 503 : 403);
    }
    const supabase = createServiceClient();
    const { data, error } = await supabase.rpc("confirm_bundle_menu_order", {
      p_menu_token: token.data, p_order_id: input.orderId,
      p_nickname: input.nickname, p_phone: input.phone, p_notes: input.notes,
      p_request_id: input.requestId,
    });
    if (error) {
      const conflict = error.message === "bundle menu order is already confirmed";
      return apiFailure(conflict ? "這份大禮包已被確認，請重新選擇或聯絡管理者。" : "這份大禮包或共同選單已無法送出，請重新整理或聯絡管理者。", 409);
    }
    const result = Array.isArray(data) ? data[0] : data;
    if (!result) return apiFailure("喊單確認失敗，請稍後再試。", 409);
    // Only after successful confirmation may this request receive its receipt.
    const { data: order, error: orderError } = await supabase.from("bundle_claim_orders")
      .select("public_token").eq("id", result.order_id)
      .eq("confirmation_request_id", input.requestId).single();
    if (orderError || !order) throw new Error("Confirmed bundle receipt unavailable");
    const claim = await fetchPublicBundleClaim(order.public_token);
    if (!claim) throw new Error("Confirmed bundle receipt unavailable");
    return apiSuccess(claim, 201);
  });
}
