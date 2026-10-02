import { z } from "zod";

import { apiFailure, apiSuccess, requireApiUser } from "@/lib/api/server-auth";
import { OFFICIAL_LINE_ID_PATTERN } from "@/lib/claims";

const updateOfficialLineSchema = z.object({
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
});

export async function PUT(request: Request) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  const parsed = updateOfficialLineSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return apiFailure("請輸入正確的官方 LINE ID，例如 @youraccount", 400);
  }
  if (auth.role !== "admin" && parsed.data.id !== auth.inventoryOwnerId) {
    return apiFailure("只能修改自己所屬庫藏的官方 LINE", 403);
  }

  const { data, error } = await auth.supabase.rpc(
    "update_inventory_official_line_id",
    {
      p_inventory_id: parsed.data.id,
      p_official_line_id: parsed.data.officialLineId,
    },
  );
  if (error) {
    const message =
      error.message === "invalid official LINE ID"
        ? "請輸入正確的官方 LINE ID，例如 @youraccount"
        : error.message;
    return apiFailure(message, 400, error.code);
  }

  return apiSuccess({
    id: data,
    officialLineId: parsed.data.officialLineId,
  });
}
