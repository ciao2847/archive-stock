import { NextRequest } from "next/server";
import { z } from "zod";
import {
  PRODUCT_SKU_PATTERN,
  QR_TOKEN_PATTERN,
} from "@/lib/config";
import { extractQrToken } from "@/lib/public-qr";
import { createClient } from "@/utils/supabase/server";

const noStoreHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
};

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

function success<T>(data: T, status = 200) {
  return Response.json(
    { success: true, data },
    { status, headers: noStoreHeaders },
  );
}

function failure(error: string, status: number) {
  return Response.json(
    { success: false, error },
    { status, headers: noStoreHeaders },
  );
}

function getProductSku(products: OrderItemRow["products"]) {
  if (Array.isArray(products)) return products[0]?.sku ?? null;
  return products?.sku ?? null;
}

async function getAuthenticatedClient() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return null;
  return supabase;
}

export async function GET(request: NextRequest) {
  const parsedOrderId = orderIdSchema.safeParse(
    request.nextUrl.searchParams.get("orderId"),
  );
  if (!parsedOrderId.success) {
    return failure("訂單 ID 格式錯誤", 400);
  }

  const supabase = await getAuthenticatedClient();
  if (!supabase) return failure("請先登入", 401);

  const { data, error } = await supabase
    .from("order_items")
    .select("quantity,scanned_quantity,products(sku)")
    .eq("order_id", parsedOrderId.data);

  if (error) return failure(`讀取核對進度失敗：${error.message}`, 400);
  if (!data) return failure("找不到訂單商品資料", 404);

  const scannedSkus = (data as unknown as OrderItemRow[]).flatMap((item) => {
    const sku = getProductSku(item.products);
    if (!sku) return [];

    return Array.from(
      { length: Math.min(item.scanned_quantity, item.quantity) },
      () => sku,
    );
  });

  return success(scannedSkus);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsedBody = requestSchema.safeParse(body);
  if (!parsedBody.success) {
    return failure("請求內容格式錯誤", 400);
  }

  const supabase = await getAuthenticatedClient();
  if (!supabase) return failure("請先登入", 401);

  if (parsedBody.data.action === "complete") {
    const { data, error } = await supabase.rpc("complete_order_packing", {
      p_order_id: parsedBody.data.orderId,
    });

    if (error) {
      const message =
        error.code === "PGRST202"
          ? "完成包裝功能尚未安裝，請先執行 complete-order-packing-migration.sql。"
          : `完成包裝失敗：${error.message}`;
      return failure(message, error.code === "PGRST202" ? 503 : 400);
    }

    return success({ completed: Boolean(data) });
  }

  const value = extractQrToken(parsedBody.data.value);
  const isProductSku = PRODUCT_SKU_PATTERN.test(value);
  const isQrToken = QR_TOKEN_PATTERN.test(value);
  if (!isProductSku && !isQrToken) {
    return success({
      result: {
        valid: false,
        reason: "invalid_scan_value",
        sku: null,
      },
    });
  }

  const response = isProductSku
    ? await supabase.rpc("consume_product_sku", {
        p_sku: value.toUpperCase(),
        p_order_id: parsedBody.data.orderId,
      })
    : await supabase.rpc("consume_product_qr", {
        p_token: value,
        p_order_id: parsedBody.data.orderId,
      });

  if (response.error) {
    return failure(`核對失敗：${response.error.message}`, 400);
  }

  const parsedResult = scanResultSchema.safeParse(response.data?.[0]);
  if (!parsedResult.success) {
    return failure("核對結果格式錯誤", 500);
  }

  return success({
    result: parsedResult.data,
    method: isProductSku ? "manual_sku" : "qr",
  });
}
