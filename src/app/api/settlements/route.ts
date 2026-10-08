import { periodSchema } from "@/lib/accounting";
import {
  apiFailure,
  apiSuccess,
  requireApiUser,
  withApiErrorHandling,
} from "@/lib/api/server-auth";
import { accountingFailure } from "@/lib/api/accounting-server";

export async function POST(request: Request) {
  return withApiErrorHandling("POST /api/settlements", async () => {
    const auth = await requireApiUser();
    if (!auth.ok) return auth.response;
    const parsed = periodSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) return apiFailure("請選擇完整的雙月帳期", 400);
    if (auth.role !== "admin" && parsed.data.ownerId !== auth.inventoryOwnerId)
      return apiFailure("無法替其他庫藏結算", 403);
    const { data, error } = await auth.supabase.rpc(
      "create_financial_settlement",
      {
        p_owner_id: parsed.data.ownerId,
        p_start: parsed.data.start,
        p_end: parsed.data.end,
      },
    );
    if (error) return accountingFailure(error.message, error.code);
    return apiSuccess({ settlement: data }, 201);
  });
}
