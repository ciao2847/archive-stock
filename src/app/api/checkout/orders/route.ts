import {
  apiFailure,
  apiSuccess,
  requireApiUser,
  withApiErrorHandling,
} from "@/lib/api/server-auth";
import { stallOrderSearchSchema } from "@/lib/stall-orders";

export async function GET(request: Request) {
  return withApiErrorHandling("GET stall orders", async () => {
    const auth = await requireApiUser();
    if (!auth.ok) return auth.response;
    const parsed = stallOrderSearchSchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success) return apiFailure("請確認查詢文字、日期與頁數", 400);
    const input = parsed.data;
    if (auth.role !== "admin" && input.ownerId !== auth.inventoryOwnerId)
      return apiFailure("權限不足", 403);
    const { data, error } = await auth.supabase.rpc("find_stall_orders", {
      p_owner_id: input.ownerId,
      p_query: input.query,
      p_status: input.status,
      p_page: input.page,
      ...(input.start ? { p_start: input.start } : {}),
      ...(input.end ? { p_end: input.end } : {}),
    });
    if (error)
      return apiFailure(
        error.code === "PGRST202"
          ? "攤位訂單管理尚未就緒"
          : "讀取攤位訂單失敗，請稍後重試",
        error.code === "PGRST202" ? 503 : 400,
      );
    return apiSuccess(data);
  });
}
