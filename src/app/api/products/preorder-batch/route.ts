import {
  apiFailure,
  apiSuccess,
  requireApiUser,
  withApiErrorHandling,
} from "@/lib/api/server-auth";
import { preorderBatchSchema } from "@/lib/validation/preorder-batch";

export async function POST(request: Request) {
  return withApiErrorHandling("POST /api/products/preorder-batch", async () => {
    const auth = await requireApiUser();
    if (!auth.ok) return auth.response;
    const origin = request.headers.get("origin");
    if (
      (origin && origin !== new URL(request.url).origin) ||
      request.headers.get("sec-fetch-site") === "cross-site"
    )
      return apiFailure("請從本站操作", 403);
    const parsed = preorderBatchSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success)
      return apiFailure(
        parsed.error.issues[0]?.message || "請確認預購商品資料",
        400,
      );
    const input = parsed.data;
    if (auth.role !== "admin" && input.ownerId !== auth.inventoryOwnerId)
      return apiFailure("只能替自己的庫藏建立預購商品", 403);
    const { data, error } = await auth.supabase.rpc(
      "create_preorder_product_batch",
      {
        p_owner_id: input.ownerId,
        p_batch_id: input.requestId,
        p_items: input.items,
      },
    );
    if (error)
      return apiFailure(
        error.message,
        error.code === "22023" ? 409 : 400,
        error.code,
      );
    if (!Array.isArray(data) || data.length !== input.items.length)
      return apiFailure("批次結果尚未確認，請使用相同批次重試", 503);
    return apiSuccess({ batchId: input.requestId, productIds: data });
  });
}
