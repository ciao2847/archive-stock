import { NextRequest } from "next/server";
import { z } from "zod";
import { PRODUCT_SKU_PATTERN, QR_TOKEN_PATTERN } from "@/constants";
import { extractQrToken } from "@/lib/public-qr";
import { apiFailure, apiSuccess, requireApiUser } from "@/lib/api/server-auth";
import { createClient } from "@/utils/supabase/server";
import type {
  PackingCompletion,
  PackingPackage,
  PackingScanResult,
} from "@/lib/api/packing";

const uuidSchema = z.string().uuid();

const requestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("start"),
    ownerId: uuidSchema,
    customerKey: z.string().trim().min(1).max(512),
  }),
  z.object({
    action: z.literal("scan"),
    packageId: uuidSchema,
    value: z.string().trim().min(1).max(2048),
  }),
  z.object({
    action: z.literal("complete"),
    packageId: uuidSchema,
  }),
]);

const scanResultSchema = z.object({
  valid: z.boolean(),
  reason: z.string(),
  sku: z.string().nullable(),
  order_id: z.string().uuid().nullable(),
  order_no: z.string().nullable(),
  order_item_id: z.string().uuid().nullable(),
});

const completionSchema = z.object({
  completed: z.boolean(),
  packageNo: z.string(),
  itemCount: z.number(),
  orderCount: z.number(),
  fullyPackedOrderCount: z.number(),
});

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

async function readPackageProgress(
  supabase: SupabaseClient,
  packageId: string,
) {
  const { data, error } = await supabase.rpc("get_packing_package_progress", {
    p_package_id: packageId,
  });
  if (error) return { error };
  if (!data || typeof data !== "object") {
    return { error: new Error("包裝進度格式錯誤") };
  }
  return { data: data as unknown as PackingPackage };
}

function rpcError(error: { code?: string; message: string }, fallback: string) {
  if (error.code === "PGRST202") {
    return apiFailure("包貨功能尚未安裝，請先執行最新資料庫 migration。", 503);
  }
  const messages: Record<string, string> = {
    "customer has no pending items": "這位客人目前沒有待出貨商品。",
    "package has no scanned items": "請至少掃描一件已到貨商品後再完成包裝。",
    "not all items have been scanned": "仍有商品尚未核對。",
    "insufficient stock": "庫存數量不足，請先重新整理庫存。",
    "packing progress changed, please refresh":
      "包貨進度已被其他使用者更新，請重新整理後再試。",
    "packing package not found": "找不到這個包裝工作，請重新整理後再試。",
  };
  return apiFailure(
    messages[error.message] || `${fallback}：${error.message}`,
    400,
  );
}

export async function GET(request: NextRequest) {
  const parsedPackageId = uuidSchema.safeParse(
    request.nextUrl.searchParams.get("packageId"),
  );
  if (!parsedPackageId.success) return apiFailure("包裝 ID 格式錯誤", 400);

  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  const result = await readPackageProgress(auth.supabase, parsedPackageId.data);
  if (result.error) return rpcError(result.error, "讀取包裝進度失敗");
  return apiSuccess(result.data);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsedBody = requestSchema.safeParse(body);
  if (!parsedBody.success) return apiFailure("請求內容格式錯誤", 400);

  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  if (parsedBody.data.action === "start") {
    const { data, error } = await auth.supabase.rpc("create_packing_package", {
      p_owner_id: parsedBody.data.ownerId,
      p_customer_key: parsedBody.data.customerKey,
    });
    if (error) return rpcError(error, "建立包裝工作失敗");
    const packageId = String(data || "");
    if (!uuidSchema.safeParse(packageId).success) {
      return apiFailure("包裝工作建立結果格式錯誤", 500);
    }
    const progress = await readPackageProgress(auth.supabase, packageId);
    if (progress.error) return rpcError(progress.error, "讀取包裝進度失敗");
    return apiSuccess(progress.data, 201);
  }

  if (parsedBody.data.action === "complete") {
    const { data, error } = await auth.supabase.rpc(
      "complete_packing_package",
      { p_package_id: parsedBody.data.packageId },
    );
    if (error) return rpcError(error, "完成包裝失敗");
    const parsed = completionSchema.safeParse(data);
    if (!parsed.success) return apiFailure("完成結果格式錯誤", 500);
    return apiSuccess(parsed.data as PackingCompletion);
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
        orderId: null,
        orderNo: null,
        orderItemId: null,
      } satisfies PackingScanResult,
      method: "manual_sku" as const,
    });
  }

  const response = isProductSku
    ? await auth.supabase.rpc("consume_product_package_sku", {
        p_package_id: parsedBody.data.packageId,
        p_sku: value.toUpperCase(),
      })
    : await auth.supabase.rpc("consume_product_package_qr", {
        p_package_id: parsedBody.data.packageId,
        p_token: value,
      });

  if (response.error) return rpcError(response.error, "核對失敗");
  const parsedResult = scanResultSchema.safeParse(response.data?.[0]);
  if (!parsedResult.success) return apiFailure("核對結果格式錯誤", 500);

  return apiSuccess({
    result: {
      valid: parsedResult.data.valid,
      reason: parsedResult.data.reason,
      sku: parsedResult.data.sku,
      orderId: parsedResult.data.order_id,
      orderNo: parsedResult.data.order_no,
      orderItemId: parsedResult.data.order_item_id,
    },
    method: isProductSku ? ("manual_sku" as const) : ("qr" as const),
  });
}
