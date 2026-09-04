import { z } from "zod";
import { apiFailure, apiSuccess, requireApiUser } from "@/lib/api/server-auth";
import { updateProductSchema } from "@/lib/validation/products";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  const parsedId = z
    .string()
    .uuid()
    .safeParse((await params).id);
  if (!parsedId.success) return apiFailure("商品 ID 格式錯誤", 400);
  const parsed = updateProductSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return apiFailure("商品資料格式不正確", 400);
  if (parsed.data.cost !== null && auth.role !== "admin") {
    return apiFailure("只有管理員可以修改商品成本", 403);
  }

  const input = parsed.data;
  const { data, error } = await auth.supabase.rpc("update_inventory_product", {
    p_product_id: parsedId.data,
    p_name: input.name,
    p_category: input.category,
    p_country: input.country,
    p_source: input.source,
    p_location: input.location,
    p_stock: input.stock,
    p_price: input.price,
    // Postgres accepts NULL here to preserve the existing cost for staff, but
    // generated function argument types cannot express nullable parameters.
    p_cost: input.cost as number,
    p_poster_format: input.format,
    p_poster_size: input.size,
    p_identifying_features: input.feature,
  });
  if (error) return apiFailure(error.message, 400, error.code);
  return apiSuccess({ updated: Boolean(data) });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiUser(["admin"]);
  if (!auth.ok) return auth.response;

  const parsedId = z
    .string()
    .uuid()
    .safeParse((await params).id);
  if (!parsedId.success) return apiFailure("商品 ID 格式錯誤", 400);

  const { data, error } = await auth.supabase.rpc("delete_inventory_product", {
    p_product_id: parsedId.data,
  });
  if (error) {
    if (error.code === "PGRST202") {
      return apiFailure("商品刪除功能尚未安裝，請先執行最新 migration。", 503);
    }
    return apiFailure("商品刪除失敗", 400);
  }

  const imagePaths = Array.isArray(data)
    ? data.filter((path): path is string => typeof path === "string")
    : [];
  let imageCleanupWarning: string | undefined;
  if (imagePaths.length) {
    const { error: storageError } = await auth.supabase.storage
      .from("product-images")
      .remove(imagePaths);
    if (storageError) imageCleanupWarning = "商品已刪除，但原圖片清除失敗。";
  }

  return apiSuccess({ deleted: true, imageCleanupWarning });
}
