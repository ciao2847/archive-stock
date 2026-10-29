import { z } from "zod";
import {
  apiFailure,
  apiSuccess,
  requireApiUser,
  withApiErrorHandling,
} from "@/lib/api/server-auth";

const requestSchema = z.object({
  inventoryId: z.string().uuid(),
  sku: z.string().trim().min(1).max(100),
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
    if (!parsed.success) return apiFailure("請選擇庫藏並填寫商品 ID", 400);

    const { data: product, error: productError } = await auth.supabase
      .from("products")
      .select("id,sku,name")
      .eq("owner_id", parsed.data.inventoryId)
      .eq("sku", parsed.data.sku)
      .maybeSingle();
    if (productError) return apiFailure("商品資料讀取失敗，請稍後再試", 503);
    if (!product) return apiFailure("這個庫藏找不到指定商品", 404);

    const { count, error } = await auth.supabase
      .from("product_qr_labels")
      .update({ printed_at: null, printed_by: null }, { count: "exact" })
      .eq("product_id", product.id)
      .eq("status", "active")
      .is("used_order_id", null)
      .not("printed_at", "is", null);
    if (error || count === null)
      return apiFailure("無法確認還原結果，請重新載入商品標籤後確認", 503);

    return apiSuccess({
      resetCount: count,
      sku: product.sku,
      productName: product.name,
    });
  });
}
