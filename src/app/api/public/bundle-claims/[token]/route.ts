import { z } from "zod";

import {
  apiFailure,
  apiSuccess,
  withApiErrorHandling,
} from "@/lib/api/server-auth";
import { fetchPublicBundleClaim } from "@/lib/api/public-bundle-claims";
import {
  bundleClaimConfirmationSchema,
  type PublicBundleClaimConfirmationResult,
} from "@/lib/bundle-claims";
import { getRequestIp, verifyClaimTurnstile } from "@/lib/turnstile";
import { createServiceClient } from "@/utils/supabase/service";

const tokenSchema = z.string().uuid();

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  return withApiErrorHandling(
    "GET /api/public/bundle-claims/[token]",
    async () => {
      const token = tokenSchema.safeParse((await params).token);
      if (!token.success) return apiFailure("無法開啟這份喊單", 404);
      const claim = await fetchPublicBundleClaim(token.data);
      if (!claim) return apiFailure("無法開啟這份喊單", 404);
      return apiSuccess(claim);
    },
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  return withApiErrorHandling(
    "POST /api/public/bundle-claims/[token]",
    async () => {
      const token = tokenSchema.safeParse((await params).token);
      if (!token.success) return apiFailure("無法開啟這份喊單", 404);
      if (request.headers.get("sec-fetch-site") === "cross-site") {
        return apiFailure("無法從其他網站送出喊單", 403);
      }

      const parsed = bundleClaimConfirmationSchema.safeParse(
        await request.json().catch(() => null),
      );
      if (!parsed.success) {
        return apiFailure(
          parsed.error.issues[0]?.message || "請確認填寫資料",
          400,
        );
      }
      const input = parsed.data;
      const turnstile = await verifyClaimTurnstile({
        token: input.turnstileToken,
        expectedHostname: new URL(request.url).hostname,
        remoteIp: getRequestIp(request.headers),
        requestId: input.requestId,
      });
      if (!turnstile.ok) {
        if (
          turnstile.reason === "misconfigured" ||
          turnstile.reason === "unavailable"
        ) {
          return apiFailure(
            "安全驗證暫時無法使用，請稍後再試或聯絡管理者。",
            503,
            turnstile.reason === "misconfigured"
              ? "TURNSTILE_MISCONFIGURED"
              : "TURNSTILE_UNAVAILABLE",
          );
        }
        return apiFailure(
          "人機驗證已失效，請重新驗證後再送出。",
          403,
          "TURNSTILE_REJECTED",
        );
      }

      const { data, error } = await createServiceClient().rpc(
        "confirm_bundle_claim_order",
        {
          p_token: token.data,
          p_nickname: input.nickname,
          p_phone: input.phone,
          p_notes: input.notes,
          p_request_id: input.requestId,
        },
      );
      if (error) {
        const known: Record<string, { message: string; status: number }> = {
          "bundle claim not found": {
            message: "無法開啟這份喊單",
            status: 404,
          },
          "bundle claim is unavailable": {
            message: "這份喊單已無法送出，請向管理者索取最新連結。",
            status: 409,
          },
          "bundle claim is expired": {
            message: "這份喊單連結已過期，請向管理者索取最新連結。",
            status: 409,
          },
          "invalid customer phone": {
            message: "請輸入 09 開頭的 10 位數手機號碼。",
            status: 400,
          },
          "invalid customer nickname": {
            message: "請輸入暱稱。",
            status: 400,
          },
        };
        const knownError = known[error.message];
        return apiFailure(
          knownError?.message ?? "喊單確認失敗，請稍後再試。",
          knownError?.status ?? 400,
          error.code,
        );
      }

      const row = Array.isArray(data) ? data[0] : data;
      if (!row) return apiFailure("喊單確認失敗，請稍後再試。", 409);
      return apiSuccess<PublicBundleClaimConfirmationResult>(
        {
          state: "confirmed",
          confirmationCode: String(row.confirmation_code),
          submittedAt: String(row.submitted_at),
        },
        201,
      );
    },
  );
}
