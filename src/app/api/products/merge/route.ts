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
    sourceId: z.string().uuid(),
    targetId: z.string().uuid(),
    token: z
      .string()
      .regex(/^[a-f0-9]{32}$/)
      .optional(),
  })
  .refine((value) => value.sourceId !== value.targetId);
const errors: Record<string, [string, number]> = {
  "employee access required": ["請登入有操作權限的帳號", 403],
  "owner access required": ["沒有此庫藏的操作權限", 403],
  "merge product not found": ["找不到商品，請重新整理後再試", 404],
  "invalid merge pair": ["請選擇兩個不同的商品", 400],
  "source is not unreceived preorder": [
    "原商品已有入庫或庫位紀錄，無法使用預售合併",
    409,
  ],
  "target is not received product": ["請選擇已有入庫紀錄的庫存商品", 409],
  "product already merged": ["商品已合併，請重新整理後查看最新資料", 409],
  "merge ownership conflict": ["商品關聯的庫藏不一致，無法合併", 409],
  "merge preview changed": ["資料已更新，請重新預覽合併內容再確認", 409],
  "merge order conflict": ["同一張訂單同時包含兩個商品，請先處理重複明細", 409],
};
export async function POST(request: Request) {
  return withApiErrorHandling("POST product merge", async () => {
    if (request.headers.get("sec-fetch-site") === "cross-site")
      return apiFailure("無法驗證操作來源", 403);
    const auth = await requireApiUser();
    if (!auth.ok) return auth.response;
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      return apiFailure("請選擇有效的預售商品及庫存商品", 400);
    const input = parsed.data;
    if (auth.role !== "admin" && input.ownerId !== auth.inventoryOwnerId)
      return apiFailure("權限不足", 403);
    const { data, error } = await auth.supabase.rpc("merge_preorder_product", {
      p_owner_id: input.ownerId,
      p_source_id: input.sourceId,
      p_target_id: input.targetId,
      p_apply: input.token !== undefined,
      p_expected_token: input.token ?? undefined,
    });
    if (error) {
      if (error.code === "PGRST202")
        return apiFailure("商品合併功能尚未安裝，請先套用最新資料庫更新", 503);
      if (["55P03", "40P01", "57014"].includes(error.code ?? ""))
        return apiFailure("目前有人正在更新資料，請稍後重新預覽再試", 409);
      const known = errors[error.message];
      return apiFailure(
        known?.[0] ?? "合併未完成，請重新整理確認商品狀態後再試",
        known?.[1] ?? 400,
      );
    }
    if (
      !data ||
      typeof data !== "object" ||
      Array.isArray(data) ||
      data.merged !== (input.token !== undefined)
    )
      return apiFailure("未能確認合併結果，請重新整理查看商品狀態", 503);
    return apiSuccess(data);
  });
}
