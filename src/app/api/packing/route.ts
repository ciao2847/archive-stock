import { NextRequest } from "next/server";
import { z } from "zod";
import {
  PRODUCT_SKU_PATTERN,
  QR_TOKEN_PATTERN,
} from "@/constants";
import { extractQrToken } from "@/lib/public-qr";
import {
  apiFailure,
  apiSuccess,
  requireApiUser,
} from "@/lib/api/server-auth";

const orderIdSchema = z.string().uuid();

const requestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("scan"),
    orderId: orderIdSchema,
    value: z.string().trim().min(1).max(2048),
  }),
  z.object({
    action: z.literal("complete"),
    orderId: orderIdSchema,
  }),
]);

const scanResultSchema = z.object({
  valid: z.boolean(),
  reason: z.string(),
  sku: z.string().nullable(),
});

type OrderItemRow = {
  quantity: number;
  scanned_quantity: number;
  products: { sku: string | null } | { sku: string | null }[] | null;
};

function getProductSku(products: OrderItemRow["products"]) {
  if (Array.isArray(products)) return products[0]?.sku ?? null;
  return products?.sku ?? null;
}

export async function GET(request: NextRequest) {
  const parsedOrderId = orderIdSchema.safeParse(
    request.nextUrl.searchParams.get("orderId"),
  );
  if (!parsedOrderId.success) {
    return apiFailure("訂單 ID 格式錯誤", 400);
  }

  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.supabase
    .from("order_items")
    .select("quantity,scanned_quantity,products(sku)")
    .eq("order_id", parsedOrderId.data);

  if (error) return apiFailure("讀取核對進度失敗", 400);
  if (!data) return apiFailure("找不到訂單商品資料", 404);

  const scannedSkus = (data as unknown as OrderItemRow[]).flatMap((item) => {
    const sku = getProductSku(item.products);
    if (!sku) return [];

    return Array.from(
      { length: Math.min(item.scanned_quantity, item.quantity) },
      () => sku,
    );
  });

  return apiSuccess(scannedSkus);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsedBody = requestSchema.safeParse(body);
  if (!parsedBody.success) {
    return apiFailure("請求內容格式錯誤", 400);
  }

  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  if (parsedBody.data.action === "complete") {
    const { data, error } = await auth.supabase.rpc("complete_order_packing", {
      p_order_id: parsedBody.data.orderId,
    });

    if (error) {
      const message =
        error.code === "PGRST202"
          ? "完成包裝功能尚未安裝，請先執行 complete-order-packing-migration.sql。"
          : `完成包裝失敗：${error.message}`;
      return apiFailure(message, error.code === "PGRST202" ? 503 : 400);
    }

    return apiSuccess({ completed: Boolean(data) });
  }

  const value = extractQrToken(parsedBody.data.value);
  const isProductSku = PRODUCT_SKU_PATTERN.test(value);
  const isQrToken = QR_TOKEN_PATTERN.test(value);
  if (!isProductSku && !isQrToken) {
    return apiSuccess({
      result: {
        valid: false,
        reason: "invalid_scan_value",
        sku: null,
      },
    });
  }

  const response = isProductSku
    ? await auth.supabase.rpc("consume_product_sku", {
        p_sku: value.toUpperCase(),
        p_order_id: parsedBody.data.orderId,
      })
    : await auth.supabase.rpc("consume_product_qr", {
        p_token: value,
        p_order_id: parsedBody.data.orderId,
      });

  if (response.error) {
    return apiFailure("核對失敗", 400);
  }

  const parsedResult = scanResultSchema.safeParse(response.data?.[0]);
  if (!parsedResult.success) {
    return apiFailure("核對結果格式錯誤", 500);
  }

  return apiSuccess({
    result: parsedResult.data,
    method: isProductSku ? "manual_sku" : "qr",
  });
}
