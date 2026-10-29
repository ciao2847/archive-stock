import { z } from "zod";
import {
  apiFailure,
  apiSuccess,
  requireApiUser,
  withApiErrorHandling,
} from "@/lib/api/server-auth";

const schema = z.object({
  ownerId: z.string().uuid(),
  bundleOrderId: z.number().int().positive(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().min(1).max(999),
        unitPrice: z
          .number()
          .finite()
          .min(0)
          .max(9_999_999_999.99)
          .refine(
            (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-7,
          ),
      }),
    )
    .min(1)
    .max(100),
});

const statusSchema = z.object({
  ownerId: z.string().uuid(),
  source: z.enum(["claim", "bundle"]),
  submissionId: z.coerce.number().int().positive(),
});

export async function GET(request: Request) {
  return withApiErrorHandling("GET /api/order-fulfillment", async () => {
    const auth = await requireApiUser();
    if (!auth.ok) return auth.response;
    const parsed = statusSchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success) return apiFailure("訂購查詢資料不正確。", 400);
    if (auth.role !== "admin" && auth.inventoryOwnerId !== parsed.data.ownerId)
      return apiFailure("無法查詢其他庫藏的訂單。", 403);
    const { data, error } = await auth.supabase
      .from("orders")
      .select("id,order_items(id)")
      .eq("owner_id", parsed.data.ownerId)
      .eq(
        parsed.data.source === "claim"
          ? "claim_submission_id"
          : "bundle_claim_order_id",
        parsed.data.submissionId,
      )
      .is("deleted_at", null)
      .maybeSingle();
    if (error) {
      if (error.code === "42703" || error.code === "PGRST204")
        return apiSuccess({ state: "unavailable" });
      return apiFailure("無法確認包貨資料，請稍後重新整理。", 503);
    }
    return apiSuccess({
      state: !data
        ? "missing_order"
        : data.order_items?.length
          ? "ready"
          : "missing_products",
    });
  });
}

export async function POST(request: Request) {
  return withApiErrorHandling("POST /api/order-fulfillment", async () => {
    const auth = await requireApiUser();
    if (!auth.ok) return auth.response;
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return apiFailure("請確認商品、數量與單價。", 400);
    if (auth.role !== "admin" && auth.inventoryOwnerId !== parsed.data.ownerId)
      return apiFailure("無法管理其他庫藏的訂單。", 403);
    const { data, error } = await auth.supabase.rpc("map_bundle_fulfillment", {
      p_owner_id: parsed.data.ownerId,
      p_order_id: parsed.data.bundleOrderId,
      p_items: parsed.data.items.map((item) => ({
        product_id: item.productId,
        quantity: item.quantity,
        unit_price: item.unitPrice,
      })),
    });
    if (error) {
      const messages: Record<string, string> = {
        "fulfillment total mismatch":
          "商品數量乘單價的合計，必須等於配單原總額。",
        "fulfillment already started":
          "這筆訂單已開始掃描、包貨或結算，不能更改商品對應。",
        "fulfillment product not found": "商品不在目前庫藏，請重新選擇。",
        "confirmed bundle not found": "找不到已確認配單，請重新整理。",
        "duplicate fulfillment products": "同一商品請合併數量。",
      };
      return apiFailure(
        error.code === "PGRST202"
          ? "本機資料庫尚未安裝訂購包貨遷移。"
          : (messages[error.message] ?? "儲存商品對應失敗，請重新整理。"),
        error.code === "PGRST202" ? 503 : 409,
      );
    }
    return apiSuccess({ orderId: String(data) });
  });
}
