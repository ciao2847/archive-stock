import { z } from "zod";
import {
  apiFailure,
  apiSuccess,
  requireApiUser,
  withApiErrorHandling,
} from "@/lib/api/server-auth";

const requestSchema = z.object({
  inventoryId: z.string().uuid(),
  productIds: z
    .array(z.string().uuid())
    .min(1)
    .max(500)
    .refine((ids) => new Set(ids).size === ids.length),
});

export async function POST(request: Request) {
  return withApiErrorHandling("POST /api/print-labels/reset", async () => {
    const auth = await requireApiUser(["admin"]);
    if (!auth.ok) return auth.response;
    const origin = request.headers.get("origin");
    if (
      (origin && origin !== new URL(request.url).origin) ||
      request.headers.get("sec-fetch-site") === "cross-site"
    )
      return apiFailure("請從本站操作", 403);

    const parsed = requestSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success)
      return apiFailure("請選擇庫藏及 1 至 500 項不重複的商品", 400);

    const { data: products, error: productError } = await auth.supabase
      .from("products")
      .select("id")
      .eq("owner_id", parsed.data.inventoryId)
      .in("id", parsed.data.productIds);
    if (productError) return apiFailure("商品資料讀取失敗，請稍後再試", 503);
    const foundIds = new Set((products ?? []).map((product) => product.id));
    if (parsed.data.productIds.some((id) => !foundIds.has(id)))
      return apiFailure(
        "部分商品不存在或不屬於目前庫藏，尚未還原任何標籤",
        404,
      );

    const { count, error } = await auth.supabase
      .from("product_qr_labels")
      .update({ printed_at: null, printed_by: null }, { count: "exact" })
      .in("product_id", parsed.data.productIds)
      .eq("status", "active")
      .is("used_order_id", null)
      .not("printed_at", "is", null);
    if (error || count === null)
      return apiFailure("無法確認還原結果，請重新載入商品標籤後確認", 503);

    return apiSuccess({
      resetCount: count,
      productCount: parsed.data.productIds.length,
    });
  });
}
