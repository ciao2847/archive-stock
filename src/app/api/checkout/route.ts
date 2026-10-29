import { z } from "zod";
import { apiFailure, apiSuccess, requireApiUser } from "@/lib/api/server-auth";
import { extractQrToken } from "@/lib/public-qr";
import { getListPrice } from "@/lib/pricing";
import { PRODUCT_SKU_PATTERN } from "@/constants";

const scanSchema = z.object({
  ownerId: z.string().uuid(),
  value: z.string().trim().min(1).max(2048),
  excludeTokens: z.array(z.string().uuid()).max(100).default([]),
});
const checkoutSchema = z.object({
  ownerId: z.string().uuid(),
  tokens: z.array(z.string().uuid()).min(1).max(100),
  expectedTotal: z.number().finite().nonnegative(),
});

export async function GET(request: Request) {
  const auth = await requireApiUser(["admin", "staff"]);
  if (!auth.ok) return auth.response;
  const params = new URL(request.url).searchParams;
  const parsed = scanSchema.safeParse({
    ...Object.fromEntries(params),
    excludeTokens: params.getAll("excludeToken"),
  });
  if (!parsed.success)
    return apiFailure("請輸入商品編號或掃描商品 QR Code", 400);
  if (auth.role !== "admin" && parsed.data.ownerId !== auth.inventoryOwnerId)
    return apiFailure("權限不足", 403);
  if (PRODUCT_SKU_PATTERN.test(parsed.data.value)) {
    const { data: product, error: productError } = await auth.supabase
      .from("products")
      .select("id,owner_id,sku,name,price,stock,status")
      .eq("sku", parsed.data.value.toUpperCase())
      .eq("owner_id", parsed.data.ownerId)
      .maybeSingle();
    if (productError) return apiFailure("讀取商品失敗", 400, productError.code);
    if (!product) return apiFailure("目前庫藏找不到這個商品編號", 404);
    if (product.status !== "in_stock" || product.stock < 1)
      return apiFailure("商品已售罄或已預留", 409);
    // Manual entry chooses a distinct unit, so it shares the same atomic
    // inventory deduction and retry protection as a scanned label.
    const { data: labels, error } = await auth.supabase
      .from("product_qr_labels")
      .select("token")
      .eq("product_id", product.id)
      .eq("status", "active")
      .order("id", { ascending: true })
      .limit(101);
    if (error) return apiFailure("讀取商品碼失敗", 400, error.code);
    const excluded = new Set(
      parsed.data.excludeTokens.map((value) => value.toLowerCase()),
    );
    const label = labels?.find(
      (item) => !excluded.has(item.token.toLowerCase()),
    );
    if (!label)
      return apiFailure(
        "此商品沒有其他可加入的商品碼，請核對購物車件數與庫存。",
        409,
      );
    return apiSuccess({
      token: label.token,
      productId: product.id,
      sku: product.sku,
      name: product.name,
      listPrice: getListPrice(Number(product.price ?? 0)),
      stock: product.stock,
    });
  }
  const token = z.string().uuid().safeParse(extractQrToken(parsed.data.value));
  if (!token.success)
    return apiFailure(
      "請輸入完整商品編號（例如 A000038）或有效的 QR Code",
      400,
    );
  const { data: label, error } = await auth.supabase
    .from("product_qr_labels")
    .select("token,product_id,status")
    .eq("token", token.data)
    .maybeSingle();
  if (error) return apiFailure("讀取商品碼失敗", 400, error.code);
  if (!label) return apiFailure("找不到商品碼或無權存取", 404);
  if (label.status !== "active")
    return apiFailure("此商品碼已使用或已失效", 409);
  const { data: product, error: productError } = await auth.supabase
    .from("products")
    .select("id,owner_id,sku,name,price,stock,status")
    .eq("id", label.product_id)
    .eq("owner_id", parsed.data.ownerId)
    .maybeSingle();
  if (productError) return apiFailure("讀取商品失敗", 400, productError.code);
  if (!product) return apiFailure("此商品不屬於目前庫藏", 404);
  if (product.status !== "in_stock" || product.stock < 1)
    return apiFailure("商品已售罄或已預留", 409);
  return apiSuccess({
    token: label.token,
    productId: product.id,
    sku: product.sku,
    name: product.name,
    listPrice: getListPrice(Number(product.price ?? 0)),
    stock: product.stock,
  });
}

export async function POST(request: Request) {
  const auth = await requireApiUser(["admin", "staff"]);
  if (!auth.ok) return auth.response;
  const parsed = checkoutSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return apiFailure("結帳資料格式錯誤", 400);
  if (auth.role !== "admin" && parsed.data.ownerId !== auth.inventoryOwnerId)
    return apiFailure("權限不足", 403);
  const { data, error } = await auth.supabase.rpc("checkout_stall_labels", {
    p_owner_id: parsed.data.ownerId,
    p_tokens: parsed.data.tokens,
    p_expected_total: parsed.data.expectedTotal,
  });
  if (error) {
    const messages: Record<string, string> = {
      "checkout label not found": "商品碼不存在或不屬於目前庫藏。",
      "checkout label unavailable":
        "其中一張商品碼已結帳或已失效，請移除後重試。",
      "product is not available": "商品庫存已變動，請重新掃描商品。",
      "checkout price changed": "商品定價已變更，請重新掃描後核對金額。",
    };
    return apiFailure(
      error.code === "PGRST202"
        ? "結帳功能尚未安裝，請套用最新資料庫 migration。"
        : messages[error.message] || "結帳失敗，請稍後再試。",
      error.code === "PGRST202" ? 503 : 409,
    );
  }
  return apiSuccess(data);
}
