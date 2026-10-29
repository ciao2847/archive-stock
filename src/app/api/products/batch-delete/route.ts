import {
  apiFailure,
  apiSuccess,
  requireApiUser,
  withApiErrorHandling,
} from "@/lib/api/server-auth";
import {
  bulkDeleteProductsSchema,
  bulkDeleteResultSchema,
} from "@/lib/validation/bulk-products";

export async function POST(request: Request) {
  return withApiErrorHandling("POST /api/products/batch-delete", async () => {
    const auth = await requireApiUser();
    if (!auth.ok) return auth.response;
    const origin = request.headers.get("origin");
    if (
      (origin && origin !== new URL(request.url).origin) ||
      request.headers.get("sec-fetch-site") === "cross-site"
    )
      return apiFailure("請從本站操作", 403);
    const parsed = bulkDeleteProductsSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success)
      return apiFailure("每批請選擇 1 至 50 項不重複的商品", 400);
    const { data, error } = await auth.supabase.rpc(
      "delete_inventory_products",
      { p_product_ids: parsed.data.productIds },
    );
    if (error) {
      if (error.message === "product not found")
        return apiFailure(
          "有商品已不存在或不屬於目前庫藏，這一批尚未刪除。請重新載入清單後再試。",
          404,
        );
      if (error.code === "42501")
        return apiFailure(
          "目前帳號沒有這些商品的刪除權限，這一批尚未刪除。",
          403,
        );
      if (error.code === "PGRST202")
        return apiFailure("批量刪除尚未就緒，請稍後再試。", 503);
      if (!/^[0-9A-Z]{5}$/.test(error.code ?? ""))
        return apiFailure("無法確認刪除結果，請重新載入商品清單後再操作。", 503);
      return apiFailure(
        "批量刪除未完成，這一批尚未刪除。請重新載入清單後再試。",
        400,
      );
    }
    const result = bulkDeleteResultSchema.safeParse(data);
    const requested = new Set(parsed.data.productIds);
    if (
      !result.success ||
      result.data.deletedProductIds.length !== requested.size ||
      new Set(result.data.deletedProductIds).size !== requested.size ||
      result.data.deletedProductIds.some((id) => !requested.has(id))
    )
      return apiFailure("無法確認刪除結果，請重新載入商品清單後再操作。", 503);
    let imageCleanupWarning: string | undefined;
    if (result.data.imagePaths.length) {
      try {
        const { error: storageError } = await auth.supabase.storage
          .from("product-images")
          .remove(result.data.imagePaths);
        if (storageError)
          imageCleanupWarning = "商品已刪除，但部分原圖片清除失敗。";
      } catch {
        imageCleanupWarning = "商品已刪除，但部分原圖片清除失敗。";
      }
    }
    return apiSuccess({
      deletedProductIds: result.data.deletedProductIds,
      imageCleanupWarning,
    });
  });
}
