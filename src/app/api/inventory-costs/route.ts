import { z } from "zod";
import {
  apiFailure,
  apiSuccess,
  requireApiUser,
  withApiErrorHandling,
} from "@/lib/api/server-auth";
import { accountingModeSchema, batchCostSchema } from "@/lib/inventory-costs";
const messages: Record<string, string> = {
  "owner access required": "只能存取自己所屬庫藏的成本資料",
  "cost batch not found": "找不到進貨批次",
  "cost batch changed; reload": "批次已被更新，請重新載入後再試",
  "settled batch cost is locked": "此批次已列入結算，成本已鎖定",
  "FIFO accounting already started": "已有批次成本紀錄，無法切回帳期成本模式",
  "invalid batch cost": "請輸入有效的單件成本，最多兩位小數",
};
function failure(error: { message: string; code?: string }) {
  return apiFailure(
    messages[error.message] ?? "成本資料處理失敗，請確認已執行最新資料庫遷移",
    error.message.includes("access") ? 403 : 409,
    error.code,
  );
}
export async function GET(request: Request) {
  return withApiErrorHandling("GET /api/inventory-costs", async () => {
    const auth = await requireApiUser();
    if (!auth.ok) return auth.response;
    const params = new URL(request.url).searchParams;
    if (params.has("productId")) {
      const parsed = z.string().uuid().safeParse(params.get("productId"));
      if (!parsed.success) return apiFailure("商品 ID 無效", 400);
      const { data, error } = await auth.supabase.rpc(
        "get_inventory_product_costs",
        { p_product_id: parsed.data },
      );
      return error ? failure(error) : apiSuccess(data);
    }
    const parsed = z.string().uuid().safeParse(params.get("ownerId"));
    if (!parsed.success) return apiFailure("庫藏 ID 無效", 400);
    if (auth.role !== "admin" && parsed.data !== auth.inventoryOwnerId)
      return apiFailure("無法查看其他庫藏", 403);
    const { data, error } = await auth.supabase
      .from("inventory_databases")
      .select("accounting_mode")
      .eq("id", parsed.data)
      .maybeSingle();
    if (error) return failure(error);
    if (!data) return apiFailure("找不到庫藏", 404);
    return apiSuccess({ mode: data.accounting_mode });
  });
}
export async function PATCH(request: Request) {
  return withApiErrorHandling("PATCH /api/inventory-costs", async () => {
    const auth = await requireApiUser();
    if (!auth.ok) return auth.response;
    const parsed = batchCostSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success)
      return apiFailure(
        parsed.error.issues[0]?.message ?? "成本格式不正確",
        400,
      );
    const input = parsed.data;
    if ("totalCost" in input) {
      const { error } = await auth.supabase.rpc("save_inventory_batch_total", {
        p_batch_id: input.batchId,
        p_total: input.totalCost,
        p_notes: input.notes,
        p_expected_revision: input.expectedRevision,
      });
      return error ? failure(error) : apiSuccess({ saved: true });
    }
    const { error } = await auth.supabase.rpc("save_inventory_batch_cost", {
      p_batch_id: input.batchId,
      p_unit_cost: input.unitCost,
      p_notes: input.notes,
      p_expected_revision: input.expectedRevision,
    });
    return error ? failure(error) : apiSuccess({ saved: true });
  });
}
export async function PUT(request: Request) {
  return withApiErrorHandling("PUT /api/inventory-costs", async () => {
    const auth = await requireApiUser();
    if (!auth.ok) return auth.response;
    const parsed = z
      .object({ ownerId: z.string().uuid(), mode: accountingModeSchema })
      .strict()
      .safeParse(await request.json().catch(() => null));
    if (!parsed.success) return apiFailure("庫藏或結算方式無效", 400);
    if (auth.role !== "admin" && parsed.data.ownerId !== auth.inventoryOwnerId)
      return apiFailure("無法修改其他庫藏", 403);
    const { error } = await auth.supabase.rpc("set_inventory_accounting_mode", {
      p_owner_id: parsed.data.ownerId,
      p_mode: parsed.data.mode,
    });
    return error ? failure(error) : apiSuccess({ saved: true });
  });
}
