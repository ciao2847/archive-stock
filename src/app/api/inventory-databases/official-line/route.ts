import { z } from "zod";

import { apiFailure, apiSuccess, requireApiUser } from "@/lib/api/server-auth";
import { OFFICIAL_LINE_ID_PATTERN } from "@/lib/claims";

const updateClaimCheckoutSchema = z.object({
  id: z.string().uuid(),
  officialLineId: z
    .string()
    .trim()
    .max(100)
    .transform((value) =>
      !value || value.startsWith("@") ? value : `@${value}`,
    )
    .refine(
      (value) => !value || OFFICIAL_LINE_ID_PATTERN.test(value),
      "官方 LINE ID 格式錯誤",
    ),
  claimCompletionMessage: z.string().trim().max(1000),
});

export async function PUT(request: Request) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  const parsed = updateClaimCheckoutSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return apiFailure("請輸入正確的官方 LINE ID，例如 @youraccount", 400);
  }
  if (auth.role !== "admin" && parsed.data.id !== auth.inventoryOwnerId) {
    return apiFailure("只能修改自己所屬庫藏的官方 LINE", 403);
  }

  const { data, error } = await auth.supabase.rpc(
    "update_inventory_claim_checkout_settings",
    {
      p_inventory_id: parsed.data.id,
      p_official_line_id: parsed.data.officialLineId,
      p_completion_message: parsed.data.claimCompletionMessage,
    },
  );
  if (error) {
    const messages: Record<string, string> = {
      "invalid official LINE ID": "請輸入正確的官方 LINE ID，例如 @youraccount",
      "claim completion message is too long":
        "喊單完成提醒不可超過 1000 個字。",
    };
    const message = messages[error.message] || error.message;
    return apiFailure(message, 400, error.code);
  }

  return apiSuccess({
    id: data,
    officialLineId: parsed.data.officialLineId,
    claimCompletionMessage: parsed.data.claimCompletionMessage,
  });
}
