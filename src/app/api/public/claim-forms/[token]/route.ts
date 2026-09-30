import { z } from "zod";

import {
  apiFailure,
  apiSuccess,
  withApiErrorHandling,
} from "@/lib/api/server-auth";
import {
  TAIWAN_MOBILE_PHONE_ERROR,
  TAIWAN_MOBILE_PHONE_PATTERN,
  type PublicClaimSubmissionResult,
} from "@/lib/claims";
import {
  getRequestIp,
  verifyClaimTurnstile,
} from "@/lib/turnstile";
import { TURNSTILE_TOKEN_MAX_LENGTH } from "@/lib/turnstile-config";
import { createClient } from "@/utils/supabase/server";

const tokenSchema = z.string().uuid();
const submissionSchema = z.object({
  nickname: z.string().trim().min(1).max(100),
  phone: z.string().regex(TAIWAN_MOBILE_PHONE_PATTERN),
  notes: z.string().trim().max(1000),
  requestId: z.string().uuid(),
  turnstileToken: z.string().min(1).max(TURNSTILE_TOKEN_MAX_LENGTH),
  website: z.literal("").optional(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().min(1).max(99),
      }),
    )
    .min(1)
    .max(100)
    .refine(
      (items) => new Set(items.map((item) => item.productId)).size === items.length,
    ),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  return withApiErrorHandling("POST /api/public/claim-forms", async () => {
    const token = tokenSchema.safeParse((await params).token);
    if (!token.success) return apiFailure("喊單連結格式錯誤", 400);

    if (request.headers.get("sec-fetch-site") === "cross-site") {
      return apiFailure("無法從其他網站送出喊單", 403);
    }

    const parsed = submissionSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      const hasPhoneError = parsed.error.issues.some(
        (issue) => issue.path[0] === "phone",
      );
      const hasTurnstileError = parsed.error.issues.some(
        (issue) => issue.path[0] === "turnstileToken",
      );
      return apiFailure(
        hasPhoneError
          ? TAIWAN_MOBILE_PHONE_ERROR
          : hasTurnstileError
            ? "請完成人機驗證後再送出。"
          : "請確認暱稱、電話與商品數量",
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
          "安全驗證暫時無法使用，請稍後再試或聯絡表單管理者。",
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

    const { data, error } = await (await createClient()).rpc(
      "submit_public_claim",
      {
        p_token: token.data,
        p_nickname: input.nickname,
        p_phone: input.phone,
        p_notes: input.notes,
        p_request_id: input.requestId,
        p_items: input.items.map((item) => ({
          product_id: item.productId,
          quantity: item.quantity,
        })),
      },
    );

    if (error) {
      if (error.code === "PGRST202") {
        return apiFailure("喊單功能尚未啟用，請聯絡表單管理者。", 503);
      }
      const messages: Record<string, { message: string; status: number }> = {
        "claim form not found": {
          message: "找不到這份喊單表單。",
          status: 404,
        },
        "claim form is closed": {
          message: "這份喊單已經截止。",
          status: 409,
        },
        "claim product is not available": {
          message: "商品清單剛剛有更新，請重新整理後再送出。",
          status: 409,
        },
        "claim request conflict": {
          message: "本次喊單發生衝突，請重新整理後再試。",
          status: 409,
        },
        "invalid customer phone": {
          message: TAIWAN_MOBILE_PHONE_ERROR,
          status: 400,
        },
        "invalid customer nickname": {
          message: "請輸入群組暱稱。",
          status: 400,
        },
      };
      const known = messages[error.message];
      return apiFailure(
        known?.message || "喊單送出失敗，請稍後再試",
        known?.status || 400,
      );
    }

    const row = data?.[0];
    if (!row) return apiFailure("喊單未完成，請稍後再試", 409);
    return apiSuccess<PublicClaimSubmissionResult>(
      {
        confirmationCode: row.confirmation_code,
        submittedAt: row.submitted_at,
      },
      201,
    );
  });
}
