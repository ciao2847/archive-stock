import { z } from "zod";
import {
  apiFailure,
  apiSuccess,
  requireApiUser,
  withApiErrorHandling,
} from "@/lib/api/server-auth";

const schema = z
  .object({
    ownerId: z.string().uuid(),
    source: z.enum(["claim", "bundle", "order"]),
    recordId: z.string().min(1).max(40),
    expectedName: z.string().max(200),
    name: z.string().trim().min(1).max(100),
  })
  .refine((input) =>
    input.source === "order"
      ? z.string().uuid().safeParse(input.recordId).success
      : /^[1-9]\d{0,15}$/.test(input.recordId),
  );
export async function PATCH(request: Request) {
  return withApiErrorHandling("PATCH customer name", async () => {
    if (request.headers.get("sec-fetch-site") === "cross-site")
      return apiFailure("無法驗證操作來源", 403);
    const auth = await requireApiUser();
    if (!auth.ok) return auth.response;
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return apiFailure("請輸入 1 至 100 字的顧客名稱", 400);
    const input = parsed.data;
    if (auth.role !== "admin" && input.ownerId !== auth.inventoryOwnerId)
      return apiFailure("權限不足", 403);
    const { data, error } = await auth.supabase.rpc(
      "update_order_customer_name",
      {
        p_owner_id: input.ownerId,
        p_source: input.source,
        p_record_id: input.recordId,
        p_expected_name: input.expectedName,
        p_name: input.name,
      },
    );
    if (error) {
      if (error.message === "customer name changed")
        return apiFailure("名稱已被更新，請關閉視窗並重新整理後再試。", 409);
      if (error.message === "name record not found")
        return apiFailure("找不到這筆紀錄，請重新整理後再試。", 404);
      return apiFailure(
        "名稱更新失敗，請重新整理後再試。",
        error.code === "PGRST202" ? 503 : 400,
      );
    }
    return apiSuccess({ updated: Boolean(data) });
  });
}
